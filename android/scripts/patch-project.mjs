// What Bubblewrap cannot be told, done to the project it just generated (regenerate.sh runs it after
// `bubblewrap update`, which rewrites these files every time). Every replacement has to match exactly
// once (or be in place already), so a Bubblewrap that changed its template fails here instead of silently losing the change.
import { cpSync, readFileSync, writeFileSync } from 'node:fs'

const { packageId } = JSON.parse(readFileSync(new URL('../twa-manifest.json', import.meta.url), 'utf8'))

const app = new URL('../app/src/main/', import.meta.url)

function patch(file, replacements) {
  const url = new URL(file, app)
  let text = readFileSync(url, 'utf8')
  for (const [from, to] of replacements) {
    const found = text.split(from).length - 1
    if (found === 0 && text.includes(to)) continue // already patched: running it twice is fine
    if (found !== 1) throw new Error(`${file}: expected "${from}" once, found ${found} times`)
    text = text.replace(from, () => to)
  }
  writeFileSync(url, text)
}

// The launcher's theme: the night window and the system splash (res/values*/themes.xml). Bubblewrap
// leaves the bare translucent platform theme.
patch('AndroidManifest.xml', [
  ['android:theme="@android:style/Theme.Translucent.NoTitleBar"', 'android:theme="@style/LauncherTheme"'],
  // The share target's file filter ".epub" is an extension; Bubblewrap copies it into the intent filter as a MIME
  // type and the install fails with MalformedMimeTypeException. application/epub+zip stays.
  ['<data android:mimeType=".epub" />', '<!-- no ".epub" here: an extension is not a MIME type -->'],
])

// The adaptive icon: Bubblewrap draws the maskable PNG shrunk onto white and has no monochrome layer.
writeFileSync(new URL('res/mipmap-anydpi-v26/ic_launcher.xml', app), `<?xml version="1.0" encoding="utf-8"?>
<!-- The adaptive icon (design/icons/app/README.md): the flat night room, the mark on nothing inside
     the 66 dp safe zone, and the same mark as one alpha shape for themed icons (Android 13+).
     Written by scripts/patch-project.mjs: Bubblewrap's own is replaced on every update. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/night" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`)
// The shell's own resources (android/overlay/res: the animated splash, the themes, the icon's layers):
// Bubblewrap empties res/ on every update, so they live beside the project and are copied in.
cpSync(new URL('../overlay/res/', import.meta.url), new URL('res/', app), { recursive: true })
// The launcher activity: Bubblewrap's only passes the launch URL through; the shell's holds the start
// until the system's splash animation has played (overlay/java/LauncherActivity.java).
writeFileSync(
  new URL(`java/${packageId.replaceAll('.', '/')}/LauncherActivity.java`, app),
  readFileSync(new URL('../overlay/java/LauncherActivity.java', import.meta.url), 'utf8').replace('PACKAGE_ID', packageId),
)
console.log('Patched the manifest theme and the adaptive icon, copied overlay/res/.')
