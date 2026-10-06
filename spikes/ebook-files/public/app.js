// Phase 0 spike for #131: what can a PWA do with the member's ebook files on Android?
import * as zip from '/vendor/zip.min.js'
import { unzipSync, inflateSync, strFromU8 } from '/vendor/fflate.js'

zip.configure({ useWebWorkers: false })

const out = document.getElementById('out')
const ms = (t) => Math.round((performance.now() - t) * 10) / 10
const heap = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1024) : null)
const mode = () => (matchMedia('(display-mode: standalone)').matches ? 'STANDALONE (installed)' : 'browser tab')
document.getElementById('mode').textContent = mode()

function log(msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg)
  out.textContent += line + '\n'
  out.scrollTop = out.scrollHeight
  fetch('/__log', { method: 'POST', body: `PAGE[${mode()}] ${line}` }).catch(() => {})
}

// ---------------------------------------------------------------- IndexedDB (handles)
const idb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('spike', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('handles')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
async function putHandle(key, value) {
  const db = await idb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite')
    tx.objectStore('handles').put(value, key)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}
async function getHandle(key) {
  if (key === 'folder' && spike.folderOverride) return spike.folderOverride
  const db = await idb()
  return new Promise((resolve, reject) => {
    const request = db.transaction('handles').objectStore('handles').get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// ---------------------------------------------------------------- 0 env
async function env() {
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null
  const info = {
    ua: navigator.userAgent,
    secure: isSecureContext,
    mode: mode(),
    origin: location.origin,
    showDirectoryPicker: typeof window.showDirectoryPicker,
    showOpenFilePicker: typeof window.showOpenFilePicker,
    showSaveFilePicker: typeof window.showSaveFilePicker,
    storageGetDirectory: typeof navigator.storage?.getDirectory,
    storagePersist: typeof navigator.storage?.persist,
    serviceWorker: 'serviceWorker' in navigator,
    controller: !!navigator.serviceWorker?.controller,
    estimate: est,
    memory: performance.memory ? { usedKB: heap(), limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576) } : null,
  }
  log({ env: info })
  return info
}

// ---------------------------------------------------------------- 1 folder
async function pickDir() {
  const t = performance.now()
  try {
    const handle = await window.showDirectoryPicker({ id: 'ebooks', mode: 'read' })
    log({ pickDir: 'ok', name: handle.name, kind: handle.kind, ms: ms(t) })
    await putHandle('folder', handle)
    log('handle stored in IndexedDB')
    return handle
  } catch (error) {
    log({ pickDir: 'error', name: error.name, message: error.message, ms: ms(t) })
  }
}

/** Recursive listing: names, sizes, lastModified. getFile() per file is what costs. */
async function scanDir(dir, prefix = '', acc = []) {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') await scanDir(handle, `${prefix}${name}/`, acc)
    else if (name.toLowerCase().endsWith('.epub')) {
      const file = await handle.getFile()
      acc.push({ path: `${prefix}${name}`, size: file.size, lastModified: file.lastModified, type: file.type, handle })
    }
  }
  return acc
}
async function scan(dir) {
  dir ??= await getHandle('folder')
  if (!dir) return log('no handle stored')
  const t = performance.now()
  try {
    const files = await scanDir(dir)
    const view = files.map(({ handle, ...rest }) => rest)
    log({ scan: { files: files.length, ms: ms(t), msPerFile: files.length ? Math.round((ms(t) / files.length) * 10) / 10 : null, totalMB: Math.round(files.reduce((n, f) => n + f.size, 0) / 1048576 * 10) / 10 } })
    log({ list: view.slice(0, 12) })
    spike.lastScan = files
    return files
  } catch (error) {
    log({ scan: 'error', name: error.name, message: error.message })
  }
}
/** Names only: no getFile() per entry. Enough to see a new or a missing file; size/lastModified need getFile(). */
async function scanNames(dir, prefix = '', acc = []) {
  dir ??= await getHandle('folder')
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') await scanNames(handle, `${prefix}${name}/`, acc)
    else if (name.toLowerCase().endsWith('.epub')) acc.push(`${prefix}${name}`)
  }
  return acc
}
async function compareScans(runs = 5) {
  const rows = []
  for (let i = 0; i < runs; i++) {
    let t = performance.now(); const names = await scanNames(); const namesMs = ms(t)
    t = performance.now(); const full = await scanDir(await getHandle('folder')); const fullMs = ms(t)
    rows.push({ files: names.length, fullFiles: full.length, namesMs, fullMs })
  }
  log({ compareScans: rows })
  return rows
}
async function readFirst(pattern) {
  const files = spike.lastScan ?? (await scan())
  const item = pattern ? files.find((f) => f.path.includes(pattern)) : files[0]
  if (!item) return log('nothing to read')
  const t = performance.now()
  const file = await item.handle.getFile()
  const t1 = performance.now()
  const bytes = new Uint8Array(await file.arrayBuffer())
  log({ read: item.path, size: bytes.length, getFileMs: ms(t) , arrayBufferMs: ms(t1), totalMs: ms(t), magic: String.fromCharCode(...bytes.slice(0, 2)), mime: file.type })
  return item
}

// ---------------------------------------------------------------- 2 permission
async function perm(request) {
  const handle = await getHandle('folder')
  if (!handle) return log({ perm: 'no handle in IndexedDB' })
  const t = performance.now()
  const result = { name: handle.name, query: await handle.queryPermission({ mode: 'read' }), queryMs: ms(t) }
  if (request) {
    const t2 = performance.now()
    try {
      result.request = await handle.requestPermission({ mode: 'read' })
    } catch (error) {
      result.request = `${error.name}: ${error.message}`
    }
    result.requestMs = ms(t2)
    result.queryAfter = await handle.queryPermission({ mode: 'read' })
  }
  try {
    const first = (await handle.entries().next()).value
    result.listing = first ? first[0] : 'empty'
  } catch (error) {
    result.listing = `${error.name}: ${error.message}`
  }
  log({ perm: result })
  return result
}

// ---------------------------------------------------------------- 7 metadata
const decoder = new DOMParser()
const xml = (text) => decoder.parseFromString(text, 'application/xml')
const textOf = (doc, tag) => [...doc.getElementsByTagName(tag)].map((el) => el.textContent.trim())

/** zip.js on a Blob: reads the central directory, then only the entries asked for. */
async function metaZipJs(file) {
  const reader = new zip.ZipReader(new zip.BlobReader(file))
  const entries = await reader.getEntries()
  const get = async (name) => {
    const entry = entries.find((e) => e.filename === name)
    return entry ? entry.getData(new zip.TextWriter()) : null
  }
  const container = await get('META-INF/container.xml')
  const opfPath = xml(container).getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  const opf = xml(await get(opfPath))
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const ids = textOf(opf, 'dc:identifier')
  // cover: EPUB3 properties="cover-image", or EPUB2 <meta name="cover" content="id">
  const items = [...opf.getElementsByTagName('item')]
  let cover = items.find((i) => (i.getAttribute('properties') ?? '').split(' ').includes('cover-image'))
  if (!cover) {
    const id = [...opf.getElementsByTagName('meta')].find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content')
    cover = items.find((i) => i.getAttribute('id') === id)
  }
  await reader.close()
  return {
    entries: entries.length,
    opfPath,
    identifiers: ids,
    title: textOf(opf, 'dc:title')[0],
    creator: textOf(opf, 'dc:creator')[0],
    language: textOf(opf, 'dc:language')[0],
    publisher: textOf(opf, 'dc:publisher')[0],
    coverHref: cover ? dir + cover.getAttribute('href') : null,
    coverSize: cover ? entries.find((e) => e.filename === dir + cover.getAttribute('href'))?.uncompressedSize : null,
  }
}
/** fflate needs the whole file as bytes; the filter keeps it from inflating the rest. */
async function metaFflate(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const files = unzipSync(bytes, { filter: (f) => f.name === 'META-INF/container.xml' || f.name.endsWith('.opf') })
  const container = strFromU8(files['META-INF/container.xml'])
  const opfPath = xml(container).getElementsByTagName('rootfile')[0].getAttribute('full-path')
  const opf = xml(strFromU8(files[opfPath]))
  return { title: textOf(opf, 'dc:title')[0], identifiers: textOf(opf, 'dc:identifier') }
}
async function meta() {
  const files = spike.lastScan ?? (await scan())
  if (!files?.length) return log('no files; scan first')
  const rows = []
  for (const item of files.slice(0, 8)) {
    const file = await item.handle.getFile()
    const h0 = heap()
    const t = performance.now()
    let zipjs, fflate
    try { zipjs = await metaZipJs(file) } catch (error) { zipjs = { error: error.message } }
    const zipMs = ms(t)
    const h1 = heap()
    const t2 = performance.now()
    try { fflate = await metaFflate(file) } catch (error) { fflate = { error: error.message } }
    const ffMs = ms(t2)
    const h2 = heap()
    rows.push({ path: item.path, sizeMB: Math.round(item.size / 10486.76) / 100, zipjsMs: zipMs, zipjsHeapDeltaKB: h1 - h0, fflateMs: ffMs, fflateHeapDeltaKB: h2 - h1, ...zipjs, fflate })
  }
  for (const row of rows) log({ meta: row })
  return rows
}

/**
 * Smallest reader: only the zip's end record, its central directory and the entries asked for are read,
 * through Blob.slice (so the rest of the book is never read into memory); fflate inflates them.
 */
async function metaSlice(file) {
  let bytesRead = 0
  const slice = async (start, end) => {
    const buf = new Uint8Array(await file.slice(start, end).arrayBuffer())
    bytesRead += buf.length
    return buf
  }
  const tailLen = Math.min(file.size, 65557)
  const tail = await slice(file.size - tailLen, file.size)
  const tv = new DataView(tail.buffer)
  let eocd = tail.length - 22
  while (eocd >= 0 && tv.getUint32(eocd, true) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('not a zip')
  const cdSize = tv.getUint32(eocd + 12, true)
  const cdOffset = tv.getUint32(eocd + 16, true)
  const cd = await slice(cdOffset, cdOffset + cdSize)
  const cv = new DataView(cd.buffer)
  const entries = new Map()
  for (let p = 0; p < cd.length && cv.getUint32(p, true) === 0x02014b50; ) {
    const nameLen = cv.getUint16(p + 28, true), extraLen = cv.getUint16(p + 30, true), commentLen = cv.getUint16(p + 32, true)
    entries.set(strFromU8(cd.subarray(p + 46, p + 46 + nameLen)), { method: cv.getUint16(p + 10, true), csize: cv.getUint32(p + 20, true), size: cv.getUint32(p + 24, true), offset: cv.getUint32(p + 42, true) })
    p += 46 + nameLen + extraLen + commentLen
  }
  const read = async (name) => {
    const e = entries.get(name)
    if (!e) return null
    const head = await slice(e.offset, e.offset + 30)
    const hv = new DataView(head.buffer)
    const start = e.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true)
    const raw = await slice(start, start + e.csize)
    return e.method === 0 ? raw : inflateSync(raw)
  }
  const opfPath = xml(strFromU8(await read('META-INF/container.xml'))).getElementsByTagName('rootfile')[0].getAttribute('full-path')
  const opf = xml(strFromU8(await read(opfPath)))
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const items = [...opf.getElementsByTagName('item')]
  let cover = items.find((i) => (i.getAttribute('properties') ?? '').split(' ').includes('cover-image'))
  if (!cover) {
    const id = [...opf.getElementsByTagName('meta')].find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content')
    cover = items.find((i) => i.getAttribute('id') === id)
  }
  return { entries: entries.size, identifiers: textOf(opf, 'dc:identifier'), title: textOf(opf, 'dc:title')[0], creator: textOf(opf, 'dc:creator')[0], language: textOf(opf, 'dc:language')[0], publisher: textOf(opf, 'dc:publisher')[0], coverHref: cover ? dir + cover.getAttribute('href') : null, bytesRead, coverBytes: cover ? entries.get(dir + cover.getAttribute('href'))?.csize : null }
}

/** Warm timings: n runs per file, first (cold) and median; zip.js (reads only what it needs) vs fflate (needs all bytes). */
async function bench(n = 15, dirName) {
  const files = spike.lastScan ?? (await scan())
  const rows = []
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
  for (const item of files) {
    const times = { zip: [], ff: [], read: [], sl: [] }; let slInfo
    for (let i = 0; i < n; i++) {
      let t = performance.now()
      const file = await item.handle.getFile()
      times.read.push(ms(t))
      t = performance.now(); await metaZipJs(file); times.zip.push(ms(t))
      t = performance.now(); await metaFflate(file); times.ff.push(ms(t))
      t = performance.now(); slInfo = await metaSlice(file); times.sl.push(ms(t))
    }
    rows.push({ path: item.path, sizeMB: Math.round(item.size / 10486.76) / 100, getFileMsMedian: median(times.read), zipjsFirstMs: times.zip[0], zipjsMedianMs: median(times.zip), fflateFirstMs: times.ff[0], fflateMedianMs: median(times.ff), sliceFirstMs: times.sl[0], sliceMedianMs: median(times.sl), sliceBytesRead: slInfo.bytesRead })
  }
  for (const row of rows) log({ bench: row })
  return rows
}

// ---------------------------------------------------------------- 6 OPFS
async function opfs() {
  const res = {}
  const root = await navigator.storage.getDirectory()
  const bytes = new Uint8Array(3 * 1024 * 1024)
  for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536))
  let t = performance.now()
  const fh = await root.getFileHandle('spike-3mb.epub', { create: true })
  const w = await fh.createWritable()
  await w.write(bytes)
  await w.close()
  res.writeMs = ms(t)
  t = performance.now()
  const back = new Uint8Array(await (await fh.getFile()).arrayBuffer())
  res.readMs = ms(t)
  res.equal = back.length === bytes.length && back.every((b, i) => b === bytes[i])
  res.size = back.length
  // Copy from a real file picked earlier (a File from the folder handle), streamed.
  if (spike.lastScan?.length) {
    const biggest = [...spike.lastScan].sort((a, b) => b.size - a.size)[0]
    const src = await biggest.handle.getFile()
    t = performance.now()
    const dst = await root.getFileHandle('copied.epub', { create: true })
    const ws = await dst.createWritable()
    await src.stream().pipeTo(ws)
    res.copyFromFolder = { name: biggest.path, size: src.size, ms: ms(t) }
  }
  res.persistedBefore = await navigator.storage.persisted()
  res.persist = await navigator.storage.persist()
  res.persistedAfter = await navigator.storage.persisted()
  const est = await navigator.storage.estimate()
  res.estimate = { quotaMB: Math.round(est.quota / 1048576), usageMB: Math.round(est.usage / 1048576 * 10) / 10 }
  await root.removeEntry('spike-3mb.epub')
  await root.removeEntry('copied.epub').catch(() => {})
  log({ opfs: res })
  return res
}

// ---------------------------------------------------------------- 5 pickers
async function pickFiles() {
  const t = performance.now()
  try {
    const handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'EPUB', accept: { 'application/epub+zip': ['.epub'] } }] })
    const files = await Promise.all(handles.map((h) => h.getFile()))
    log({ showOpenFilePicker: 'ok', ms: ms(t), files: files.map((f) => ({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified })) })
    await putHandle('file0', handles[0])
    log('first file handle stored in IndexedDB')
  } catch (error) {
    log({ showOpenFilePicker: 'error', name: error.name, message: error.message })
  }
}
document.querySelector('[data-testid=input]').addEventListener('change', (event) => {
  const files = [...event.target.files]
  log({ inputFile: files.map((f) => ({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified })) })
})

// ---------------------------------------------------------------- 4 share
async function shared() {
  const id = new URL(location.href).searchParams.get('shared')
  const cache = await caches.open('shared-ebooks')
  const keys = (await cache.keys()).map((r) => new URL(r.url).pathname).filter((p) => p.endsWith('/meta'))
  const ids = id ? [`/__shared/${id}/meta`] : keys
  for (const key of ids) {
    const metaRes = await cache.match(key)
    if (!metaRes) continue
    const info = await metaRes.json()
    log({ shared: info })
    // read each file back from the cache and take its metadata
    for (const f of info.files) {
      const res = await cache.match(`/__shared/${info.id}/${f.index}`)
      const blob = await res.blob()
      const t = performance.now()
      let m
      try { m = await metaZipJs(new File([blob], f.name, { type: f.type })) } catch (error) { m = { error: error.message } }
      log({ sharedFile: f.name, bytesBack: blob.size, metaMs: ms(t), title: m.title, ids: m.identifiers })
    }
  }
  const sp = new URL(location.href).searchParams
  if (location.pathname === '/share') log({ shareText: Object.fromEntries(sp) })
}

// ---------------------------------------------------------------- desktop stand-in
/** Desktop automation cannot drive the native folder dialog: fill OPFS with the fixtures (a real FileSystemDirectoryHandle, same API) and use it as the folder. */
async function useOpfsFolder(names, copies = 0) {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle('Books', { create: true })
  for (const name of names) {
    const bytes = await (await fetch(`/__fixtures/${name}`)).arrayBuffer()
    const write = async (d, n) => { const w = await (await d.getFileHandle(n, { create: true })).createWritable(); await w.write(bytes); await w.close() }
    await write(dir, name)
    for (let i = 0; i < copies; i++) await write(await dir.getDirectoryHandle(`bulk/${i % 9}`.replace('/', '-'), { create: true }), name.replace('.epub', `-copy${i}.epub`))
  }
  spike.folderOverride = dir // (an OPFS handle read back from IndexedDB crashes the headless shell)
  return dir.name
}

// ---------------------------------------------------------------- wiring
const spike = { useOpfsFolder, scanNames, compareScans, metaSlice, bench, metaZipJs, metaFflate, env, pickDir, scan, readFirst, perm, meta, opfs, pickFiles, shared, getHandle, log }
window.spike = spike
const click = (id, fn) => document.querySelector(`[data-testid=${id}]`).addEventListener('click', fn)
click('env', env)
click('pickDir', pickDir)
click('scan', () => scan())
click('read', () => readFirst())
click('perm', () => perm(false))
click('req', () => perm(true))
click('meta', meta)
click('opfs', opfs)
click('pickFiles', pickFiles)
click('share', shared)
click('clear', () => (out.textContent = ''))

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(() => log('sw registered'))

// On every load: report what the stored handle says without prompting (read-only query).
;(async () => {
  log(`load ${location.pathname}${location.search} mode=${mode()}`)
  const handle = await getHandle('folder').catch(() => null)
  if (handle) {
    try { log({ onLoad: { handle: handle.name, query: await handle.queryPermission({ mode: 'read' }) } }) } catch (e) { log({ onLoad: 'queryPermission threw ' + e.message }) }
  } else log({ onLoad: 'no handle stored' })
  const fileHandle = await getHandle('file0').catch(() => null)
  if (fileHandle) {
    try {
      const query = await fileHandle.queryPermission({ mode: 'read' })
      let read = null
      try { read = (await fileHandle.getFile()).size } catch (e) { read = `${e.name}: ${e.message}` }
      log({ onLoadFile: { name: fileHandle.name, query, readSizeWithoutRequest: read } })
    } catch (e) { log({ onLoadFile: 'queryPermission threw ' + e.message }) }
  }
  if (new URL(location.href).searchParams.has('shared') || location.pathname === '/share') await shared()
})()
