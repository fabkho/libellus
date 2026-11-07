// Static mock-up engine for docs/plans/notes-composer.md. One phone, three composers (V1 today-fixed, V2 in the capsule,
// V3 send-as), two contexts (Notes: scope + Spoiler; buddy read: Spoiler only), a faux ~291 px keyboard, a switch for
// today's behaviour. Everything is a real <button> with a name and a state. No app code.
// URL params (all optional): theme=light|dark lang=en|de w=360|390 ctx=notes|buddy big=1 hits=1 kb=1 level=private|friends|public
// spoiler=1 reply=1 rec=1 menu=1 text=… mode=today|fixed (V1) embed=1 (phone only) back=1 (keyboard closed, field still focused)
;(() => {
  const Q = new URLSearchParams(location.search)
  const V = Number(document.body.dataset.v)
  const S = {
    theme: Q.get('theme') === 'dark' ? 'dark' : 'light',
    lang: Q.get('lang') === 'de' ? 'de' : 'en',
    w: Q.get('w') === '360' ? 360 : 390,
    ctx: Q.get('ctx') === 'buddy' ? 'buddy' : 'notes',
    big: Q.get('big') === '1',
    hits: Q.get('hits') === '1',
    kb: Q.get('kb') === '1',
    focus: Q.get('kb') === '1' || Q.get('back') === '1',
    level: ['private', 'friends', 'public'].includes(Q.get('level')) ? Q.get('level') : 'friends',
    remembered: 'friends',
    spoiler: Q.get('spoiler') === '1',
    reply: Q.get('reply') === '1',
    rec: Q.get('rec') === '1',
    menu: Q.get('menu') === '1',
    text: Q.get('text') || '',
    mode: Q.get('mode') === 'today' ? 'today' : 'fixed',
    sent: [],
  }
  const embed = Q.get('embed') === '1'
  if (embed) document.body.classList.add('embed')

  // ------------------------------------------------------------------ words (the app's strings from en.json / de.json; "new" ones are proposals)
  const T = {
    en: {
      chapter: 'Chapter 5', chapters: 'Chapters 1–5', book: 'The Salt Orchard', day: '14 Oct', today: 'Today',
      m1: 'The grandmother’s recipe is the same list as the orchard map.', m2: 'Third time reading it. This chapter still gets me.',
      m3: 'Note to self: the well again. Count the pears.', b2: 'Chapter 5 and I’m already guessing the ending.', b3: 'No spoilers, please!', veil: 'Spoiler · tap to show',
      quoteWho: 'Ben', quoteText: 'The grandmother’s recipe is the same list…',
      phNotes: 'A note on chapter 5', phBuddy: 'Say something about this part', spoiler: 'Spoiler', scopeLabel: 'Who can see this',
      private: 'Only me', friends: 'Friends', public: 'Everyone',
      privateHint: 'Just you: your notebook for this chapter.', friendsHint: 'Members you follow who follow you back.', publicHint: 'Every member of BetterReads, with your name and photo.',
      publicNotice: 'Visible to all members of BetterReads, with your name and photo. Just this note.', held: 'Can’t be wider than the note you answer.',
      send: 'Send', mic: 'Record a voice message', cancelReply: 'Cancel reply', reply: 'Reply to', you: 'You', back: 'Back',
      sendAs: 'Send as', spoilerHint: 'Spoiler: hidden for others until they tap.', spoilerRow: 'Spoiler', spoilerRowHint: 'Hidden for others until they tap', removeSpoiler: 'Remove Spoiler',
      slide: 'Slide to cancel', done: 'Done', options: 'Send options',
    },
    de: {
      chapter: 'Kapitel 5', chapters: 'Kapitel 1–5', book: 'The Salt Orchard', day: '14. Okt', today: 'Heute',
      m1: 'Das Rezept der Großmutter ist dieselbe Liste wie die Karte des Obstgartens.', m2: 'Ich lese es zum dritten Mal. Dieses Kapitel trifft mich immer noch.',
      m3: 'Notiz an mich: wieder der Brunnen. Birnen zählen.', b2: 'Kapitel 5 und ich rate schon das Ende.', b3: 'Bitte keine Spoiler!', veil: 'Spoiler · zum Anzeigen tippen',
      quoteWho: 'Ben', quoteText: 'Das Rezept der Großmutter ist dieselbe Liste…',
      phNotes: 'Eine Notiz zu Kapitel 5', phBuddy: 'Schreib etwas zu diesem Teil', spoiler: 'Spoiler', scopeLabel: 'Wer das sehen kann',
      private: 'Nur ich', friends: 'Freunde', public: 'Alle',
      privateHint: 'Nur du: dein Notizbuch zu diesem Kapitel.', friendsHint: 'Mitglieder, denen du folgst und die dir folgen.', publicHint: 'Alle Mitglieder von BetterReads, mit deinem Namen und Foto.',
      publicNotice: 'Für alle Mitglieder von BetterReads sichtbar, mit deinem Namen und Foto. Nur diese Notiz.', held: 'Kann nicht weiter sichtbar sein als die Notiz, auf die du antwortest.',
      send: 'Senden', mic: 'Sprachnachricht aufnehmen', cancelReply: 'Antwort abbrechen', reply: 'Antwort an', you: 'Du', back: 'Zurück',
      sendAs: 'Senden als', spoilerHint: 'Spoiler: für andere verdeckt, bis sie tippen.', spoilerRow: 'Spoiler', spoilerRowHint: 'Für andere verdeckt, bis sie tippen', removeSpoiler: 'Spoiler entfernen',
      slide: 'Zum Abbrechen wischen', done: 'Fertig', options: 'Sendeoptionen',
    },
  }
  const ICON = {
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    friends: '<circle cx="9" cy="9" r="3"/><circle cx="16.5" cy="10" r="2.5"/><path d="M3.5 19c.6-3 2.8-5 5.5-5s4.9 2 5.5 5M14 14.6c.8-.4 1.6-.6 2.5-.6 2.2 0 4 1.6 4.5 4"/>',
    globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.2 3.5 5 3.5 8s-1 5.8-3.5 8c-2.5-2.2-3.5-5-3.5-8s1-5.8 3.5-8z"/>',
    eyeOff: '<path d="M3 12s3.5-6 9-6c1.6 0 3 .5 4.2 1.2M21 12s-3.5 6-9 6c-1.6 0-3-.5-4.2-1.2M4 4l16 16"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    send: '<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    chev: '<path d="m7 10 5 5 5-5"/>',
    x: '<path d="M7 7l10 10M17 7 7 17"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  }
  ICON.private = ICON.lock
  ICON.public = ICON.globe
  const ico = (n, c = '') => `<svg class="ico ${c}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`
  const LEVELS = ['private', 'friends', 'public']
  const t = () => T[S.lang]
  const notes = () => S.ctx === 'notes'
  const parentLevel = () => (S.reply ? 'friends' : null) // Ben's note is a Friends note: a reply may not be wider
  const disabled = (l) => l === 'public' && S.reply
  const clamp = (l) => (disabled(l) ? 'friends' : l)
  const hasText = () => S.text.trim().length > 0
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])

  // ------------------------------------------------------------------ the thread
  function thread() {
    const w = t()
    const out = [`<p class="day">${w.day}</p>`]
    const ben = `<div class="msg"><p class="who">Ben</p><div class="line"><span class="av" aria-hidden="true">B</span><div class="bub">${w.m1}</div></div></div>`
    if (notes()) {
      out.push(ben)
      out.push(`<div class="msg"><p class="who">Mira K. <span class="mark pub">${ico('globe')}${w.public}</span></p><div class="line"><span class="av plain" aria-hidden="true">MK</span><div class="bub">${w.m2}</div></div></div>`)
      out.push(`<div class="msg mine"><div class="line"><div class="bub">${w.m3}</div></div><div class="meta"><span class="mark">${ico('lock')}${w.private}</span></div></div>`)
    } else {
      out.push(ben)
      out.push(`<div class="msg"><p class="who">Mira</p><div class="line"><span class="av plain" aria-hidden="true">M</span><div class="bub">${w.b2}</div></div></div>`)
      out.push(`<div class="msg mine"><div class="line"><div class="bub">${w.b3}</div></div></div>`)
      out.push(`<div class="msg"><div class="line"><span class="av" aria-hidden="true">B</span><div class="bub veil">${ico('eyeOff')}<span>${w.veil}</span></div></div></div>`)
    }
    for (const m of S.sent) {
      const marks = []
      if (notes() && m.level === 'private') marks.push(`<span class="mark">${ico('lock')}${w.private}</span>`)
      if (notes() && m.level === 'public') marks.push(`<span class="mark pub">${ico('globe')}${w.public}</span>`)
      if (m.spoiler) marks.push(`<span class="mark">${ico('eyeOff')}${w.spoiler}</span>`)
      out.push(`<div class="msg mine"><div class="line"><div class="bub">${esc(m.text)}</div></div>${marks.length ? `<div class="meta">${marks.join('')}</div>` : ''}</div>`)
    }
    return out.join('')
  }

  // ------------------------------------------------------------------ pieces shared by the versions
  const fieldHtml = () => {
    const w = t()
    const ph = notes() ? w.phNotes : w.phBuddy
    const caret = S.focus ? '<span class="caret"></span>' : ''
    const inner = hasText() ? `${esc(S.text)}${caret}` : `${caret}${ph}`
    return `<div class="field ${hasText() ? '' : 'ph'}" role="textbox" aria-multiline="true" aria-label="${notes() ? w.phNotes : w.phBuddy}" tabindex="0" data-act="field">${inner}</div>`
  }
  const quoteBar = () => {
    const w = t()
    return `<div class="quote" role="status"><i></i><div class="t"><b>${w.reply} ${w.quoteWho}</b><span>${w.quoteText}</span></div><button class="x hit" type="button" aria-label="${w.cancelReply}" data-act="unreply">${ico('x')}</button></div>`
  }
  const recLine = () => `<div class="rec"><span class="dot"></span><span class="mono">0:07</span><span class="slide">‹ ${t().slide}</span></div>`
  // send (ink when there is something to say) or, in a buddy read with an empty field, the microphone in its place
  const sendBtn = (extra = '') => {
    const w = t()
    if (S.rec) return `<button class="send held ${extra}" type="button" aria-label="${w.mic}" data-act="mic">${ico('mic')}</button>`
    if (!notes() && !hasText()) return `<button class="send mic ${extra}" type="button" aria-label="${w.mic}" data-act="mic">${ico('mic')}</button>`
    return `<button class="send ${hasText() ? 'go' : ''} ${extra}" type="button" aria-label="${w.send}" ${hasText() ? '' : 'aria-disabled="true"'} data-act="send">${ico('send')}</button>`
  }
  const lvlWord = (l) => t()[l]

  // ------------------------------------------------------------------ V1: today, fixed
  function seg(l) {
    const on = S.level === l
    const dis = disabled(l)
    return `<button class="seg hit ${l === 'public' ? 'pub' : ''}" type="button" role="radio" aria-checked="${on}" ${dis ? 'aria-disabled="true"' : ''} aria-label="${lvlWord(l)}" data-act="level:${l}" data-m="Scope segment">${ico(l)}<span class="nm">${lvlWord(l)}</span></button>`
  }
  function row1() {
    const w = t()
    const spoilerChip = `<button class="ctl hit" type="button" aria-pressed="${S.spoiler}" data-act="spoiler" data-m="Spoiler chip">${ico(S.spoiler ? 'check' : 'eyeOff')}<span>${w.spoiler}</span></button>`
    const scope = notes() ? `<div class="ctl scope" role="radiogroup" aria-label="${w.scopeLabel}" data-m="Scope control">${LEVELS.map(seg).join('')}</div>` : ''
    const held = notes() && S.reply ? `<p class="foot" data-testid="levelHeld">${w.held}</p>` : ''
    return `<div class="row1" role="toolbar" aria-label="${w.options}">${spoilerChip}${scope}</div>${held}`
  }
  function dock1() {
    const w = t()
    const folded = S.mode === 'today' && S.focus // today: the base folds the row while the field has focus (blur is the only way back)
    const parts = []
    if (notes() && S.level === 'public') parts.push(`<p class="notice" role="status">${w.publicNotice}</p>`)
    if (!folded) parts.push(row1())
    if (S.reply) parts.push(quoteBar())
    parts.push(`<div class="capsule">${S.rec ? recLine() : fieldHtml()}${sendBtn()}</div>`)
    return parts.join('')
  }

  // ------------------------------------------------------------------ V2: everything inside the capsule
  function heads() {
    const w = t()
    const out = []
    if (notes() && S.level === 'public') out.push({ i: 'globe', b: w.public, x: w.publicNotice, lit: true })
    if (notes() && S.level === 'private') out.push({ i: 'lock', b: w.private, x: w.privateHint, lit: false })
    if (S.spoiler) out.push({ i: 'eyeOff', b: w.spoiler, x: w.spoilerHint.replace(/^[^:]+: /, ''), lit: true })
    if (notes() && S.reply && S.level !== 'public') out.push({ i: 'friends', b: '', x: w.held, lit: false, plain: true })
    return out
  }
  function menu2() {
    const w = t()
    const opt = (l) => {
      const hint = disabled(l) ? w.held : w[`${l}Hint`]
      return `<button class="opt ${l === 'public' ? 'pub' : ''}" type="button" role="menuitemradio" aria-checked="${S.level === l}" ${disabled(l) ? 'aria-disabled="true"' : ''} data-act="level:${l}">${ico(l, 'm')}<span class="tx">${lvlWord(l)}<small>${hint}</small></span>${ico('check', 'tick')}</button>`
    }
    return `<div class="pop" role="menu" aria-label="${w.scopeLabel}"><p class="cap">${w.scopeLabel}</p>${LEVELS.map(opt).join('')}</div>`
  }
  function dock2() {
    const w = t()
    const hs = heads()
    const headHtml = hs.map((h, k) => `<p class="head ${h.lit ? 'lit' : ''}" role="status" style="${k ? 'padding-top:4px' : ''}">${ico(h.i)}<span>${h.b ? `<b>${h.b}</b> · ` : ''}${h.x}</span></p>`).join('')
    const scopeBtn = notes()
      ? `<button class="ib hit ${S.level === 'public' ? 'lit' : ''}" type="button" aria-haspopup="menu" aria-expanded="${S.menu}" aria-label="${w.scopeLabel}: ${lvlWord(S.level)}" data-act="menu" data-m="Scope button">${ico(S.level)}${ico('chev', 's')}</button>`
      : ''
    const spoilerBtn = `<button class="ib hit" type="button" aria-pressed="${S.spoiler}" aria-label="${w.spoiler}" data-act="spoiler" data-m="Spoiler button">${ico('eyeOff')}</button>`
    const line = S.rec
      ? `<div class="line">${recLine()}${spoilerBtn}${sendBtn()}</div>`
      : `<div class="line">${scopeBtn}${fieldHtml()}${spoilerBtn}${sendBtn()}</div>`
    const parts = []
    if (S.reply) parts.push(quoteBar())
    parts.push(`<div class="capsule c2">${S.menu && notes() ? menu2() : ''}${headHtml}${line}</div>`)
    return parts.join('')
  }

  // ------------------------------------------------------------------ V3: send as (split send button)
  function menu3() {
    const w = t()
    const opt = (l) => {
      const hint = disabled(l) ? w.held : w[`${l}Hint`]
      return `<button class="opt ${l === 'public' ? 'pub' : ''}" type="button" role="menuitemradio" aria-checked="${S.level === l}" ${disabled(l) ? 'aria-disabled="true"' : ''} data-act="level:${l}">${ico(l, 'm')}<span class="tx">${lvlWord(l)}<small>${hint}</small></span>${ico('check', 'tick')}</button>`
    }
    const sw = `<button class="opt chk" type="button" role="menuitemcheckbox" aria-checked="${S.spoiler}" data-act="spoiler">${ico('eyeOff', 'm')}<span class="tx">${w.spoilerRow}<small>${w.spoilerRowHint}</small></span><span class="sw" aria-hidden="true"></span></button>`
    return `<div class="pop right" role="menu" aria-label="${w.options}">${notes() ? `<p class="cap">${w.sendAs}</p>${LEVELS.map(opt).join('')}<hr>` : ''}${sw}</div>`
  }
  function dock3() {
    const w = t()
    const can = hasText()
    const lvl = notes() ? S.level : null
    const word = lvl && lvl !== 'friends' ? `<span>${lvlWord(lvl)}</span>` : ''
    const scIcon = notes() ? ico(S.level) : ico('eyeOff')
    const scName = notes() ? `${w.sendAs}: ${lvlWord(S.level)}` : w.options
    let go
    if (S.rec) go = `<button class="gb" type="button" aria-label="${w.mic}" data-act="mic">${ico('mic')}</button>`
    else if (!notes() && !can) go = `<button class="gb" type="button" aria-label="${w.mic}" data-act="mic">${ico('mic')}</button>`
    else go = `<button class="gb" type="button" aria-label="${w.send}${lvl ? ' · ' + lvlWord(S.level) : ''}" ${can ? '' : 'aria-disabled="true"'} data-act="send">${ico('send')}</button>`
    const live = can || S.rec
    const split = `<div class="split ${live ? 'go' : ''} ${live && lvl === 'public' ? 'pub' : ''}" data-m="Send split"><button class="sc" type="button" aria-haspopup="menu" aria-expanded="${S.menu}" aria-label="${scName}" data-act="menu" data-m="Scope tab">${scIcon}${word}${ico('chev', 's')}</button>${go}</div>`
    const token = S.spoiler ? `<span class="token">${ico('eyeOff')}${w.spoiler}<button class="x" type="button" aria-label="${w.removeSpoiler}" data-act="spoiler">${ico('x', 's')}</button></span>` : ''
    const parts = []
    if (notes() && S.level === 'public') parts.push(`<p class="notice" role="status">${w.publicNotice}</p>`)
    if (notes() && S.reply) parts.push(`<p class="foot">${w.held}</p>`)
    if (S.reply) parts.push(quoteBar())
    parts.push(`<div class="capsule c3">${S.menu ? menu3() : ''}${S.rec ? recLine() : token + fieldHtml()}${split}</div>`)
    return parts.join('')
  }

  // ------------------------------------------------------------------ the phone
  const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  function keyboard() {
    const k = (c) => `<button class="key" type="button" tabindex="-1" aria-hidden="true" data-act="key:${c}">${c}</button>`
    return `<div class="keyboard" aria-hidden="true"><div class="pred"><span>“${S.lang === 'de' ? 'Das' : 'The'}”</span><span>${S.lang === 'de' ? 'Ich' : 'I'}</span><span>${S.lang === 'de' ? 'Und' : 'It'}</span><button class="done" type="button" tabindex="-1" data-act="done" title="${t().done}">⌄</button></div>
      <div class="krow">${[...KEYS[0]].map(k).join('')}</div><div class="krow">${[...KEYS[1]].map(k).join('')}</div>
      <div class="krow"><span class="key alt">⇧</span>${[...KEYS[2]].map(k).join('')}<button class="key alt" type="button" tabindex="-1" data-act="key:back">⌫</button></div>
      <div class="krow"><span class="key alt">123</span><button class="key wide" type="button" tabindex="-1" data-act="key: ">space</button><span class="key ret">return</span></div></div>`
  }
  function phone() {
    const w = t()
    const dock = V === 1 ? dock1() : V === 2 ? dock2() : dock3()
    return `<div class="phone w${S.w} ${S.kb ? 'kb' : ''} ${S.big ? 'big' : ''} ${S.hits ? 'hits' : ''}">
      <div class="glow"></div>
      <div class="screen">
        <div class="status" aria-hidden="true"><span>9:41</span><span class="mono" style="font-size:12px;letter-spacing:2px">▪▪▪ ▮</span></div>
        <div class="topbar"><div class="round" aria-hidden="true">${ico('back', 'm')}</div><div class="mid"><h1>${notes() ? w.chapter : w.chapters}</h1><p class="sub">${w.book}</p></div><div></div></div>
        <div class="thread" data-act="thread" role="log" aria-label="${notes() ? w.chapter : w.chapters}">${thread()}</div>
        <div class="dock" data-testid="dock">${dock}</div>
      </div>${keyboard()}</div>`
  }

  // ------------------------------------------------------------------ behaviour
  const root = document.getElementById('app')
  function render() {
    document.documentElement.dataset.theme = S.theme
    document.documentElement.lang = S.lang
    const act = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.act : null
    const stage = root.querySelector('.stage')
    stage.innerHTML = phone()
    if (act && act !== 'field' && !act.startsWith('key:')) stage.querySelector(`[data-act="${CSS.escape(act)}"]`)?.focus({ preventScroll: true })
    panelSync()
  }
  function blur() { S.focus = false; S.kb = false; S.menu = false }
  function act(a) {
    if (a === 'field') { S.focus = true; S.kb = true; S.menu = false }
    else if (a === 'done') blur()
    else if (a === 'spoiler') S.spoiler = !S.spoiler
    else if (a === 'unreply') { S.reply = false }
    else if (a === 'menu') S.menu = !S.menu
    else if (a === 'mic') S.rec = !S.rec
    else if (a === 'send') {
      if (!hasText()) return
      S.sent.push({ text: S.text.trim(), level: notes() ? S.level : 'friends', spoiler: S.spoiler })
      S.text = ''; S.spoiler = false; S.reply = false; S.menu = false
      S.level = clamp(S.remembered) // Everyone is for one note: back to the remembered level
    } else if (a.startsWith('level:')) {
      const l = a.slice(6)
      if (disabled(l)) return
      S.level = l
      if (l !== 'public') S.remembered = l
      S.menu = false
    } else if (a.startsWith('key:')) {
      const c = a.slice(4)
      if (c === 'back') S.text = S.text.slice(0, -1)
      else S.text += S.text === '' ? c.toUpperCase() : c
    }
    S.level = clamp(S.level)
    render()
  }
  let dragY = null
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]')
    if (!el || el.dataset.act === 'thread') return
    act(el.dataset.act)
  })
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.menu) { S.menu = false; render() }
    if (e.key === 'Enter' && e.target.dataset?.act === 'field') act('field')
  })
  // a drag on the thread closes the keyboard (UiChatThread), a tap does not (iOS)
  root.addEventListener('pointerdown', (e) => { dragY = e.target.closest('.thread') ? e.clientY : null })
  root.addEventListener('pointermove', (e) => { if (dragY !== null && Math.abs(e.clientY - dragY) > 10) { dragY = null; if (S.focus) { blur(); render() } } })
  root.addEventListener('pointerup', () => { dragY = null })

  // ------------------------------------------------------------------ the page around the phone
  const META = {
    1: { name: 'V1 · Today, fixed', lead: 'The chip row stays above the capsule and never folds. Spoiler and the scope control are one shape: 36 px high, pill, 13 px type, 12 px padding, a 44 px finger target.', try: 'Tap the field, then close the keyboard three ways (Done ⌄, a drag on the thread, “Android back”). Flip Behaviour to “Today (bug)” to see what happens now.' },
    2: { name: 'V2 · In the capsule', lead: 'Scope and Spoiler are two icon buttons inside the capsule, so nothing sits outside it and nothing can fold away. A note that is not plain Friends says so in the capsule’s own header line.', try: 'Tap the people icon for the three choices, tap the eye for Spoiler, then pick Everyone or Only me and watch the header line.' },
    3: { name: 'V3 · Send as', lead: 'The audience belongs to the act of sending: the send button is split, tap sends in the current scope, the small tab beside it opens Send as + Spoiler. The button’s colour and word are the cue.', try: 'Type something (tap the keys), open the tab, pick Everyone: the send button turns amber and says so. Send it.' },
  }
  const grp = (label, key, opts) => `<div class="grp"><b>${label}</b><div class="opts">${opts.map(([val, name]) => `<button type="button" data-set="${key}=${val}" aria-pressed="false">${name}</button>`).join('')}</div></div>`
  function buildPanel() {
    const m = META[V]
    const p = document.createElement('div')
    p.className = 'panel'
    p.innerHTML = `<h1>${m.name}</h1><p class="lead">${m.lead}</p>
      ${grp('Theme', 'theme', [['light', 'Light'], ['dark', 'Dark']])}${grp('Language', 'lang', [['en', 'EN'], ['de', 'DE']])}
      ${grp('Phone', 'w', [['360', '360×640'], ['390', '390×844']])}${grp('Context', 'ctx', [['notes', 'Notes (scope + Spoiler)'], ['buddy', 'Buddy read (Spoiler)']])}
      ${grp('Keyboard', 'kbm', [['down', 'Down'], ['up', 'Up'], ['back', 'Android back (closed, field still focused)']])}
      ${grp('Scope of the note', 'level', [['private', 'Only me'], ['friends', 'Friends'], ['public', 'Everyone']])}
      ${grp('Spoiler', 'spoiler', [['0', 'Off'], ['1', 'On']])}${grp('Reply (quote bar)', 'reply', [['0', 'Off'], ['1', 'Reply to Ben']])}
      ${grp('Voice (buddy read)', 'rec', [['0', 'Idle'], ['1', 'Microphone held']])}
      ${V === 1 ? grp('Behaviour', 'mode', [['fixed', 'Fixed'], ['today', 'Today (bug)']]) : V === 2 ? grp('Scope menu', 'menu', [['0', 'Closed'], ['1', 'Open']]) : grp('Send options', 'menu', [['0', 'Closed'], ['1', 'Open']])}
      ${grp('Text', 'big', [['0', '100 %'], ['1', '200 %']])}${grp('Finger targets', 'hits', [['0', 'Hidden'], ['1', 'Show the 44 px areas']])}
      <p class="tip">${m.try}</p><div class="measure" id="measure"></div>
      <p class="tip"><a href="index.html">← all three side by side</a> · <a href="../../plans/notes-composer.md">the document</a></p>`
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-set]')
      if (!b) return
      const [k, v] = b.dataset.set.split('=')
      if (k === 'theme' || k === 'lang' || k === 'ctx' || k === 'mode') S[k] = v
      else if (k === 'w') S.w = Number(v)
      else if (k === 'big' || k === 'hits' || k === 'spoiler' || k === 'rec' || k === 'menu') S[k] = v === '1'
      else if (k === 'reply') { S.reply = v === '1' }
      else if (k === 'level') { if (!disabled(v)) { S.level = v; if (v !== 'public') S.remembered = v } }
      else if (k === 'kbm') { S.kb = v === 'up'; S.focus = v !== 'down'; S.menu = false }
      S.level = clamp(S.level)
      render()
    })
    return p
  }
  function current(k) {
    return { theme: S.theme, lang: S.lang, w: String(S.w), ctx: S.ctx, level: S.level, spoiler: S.spoiler ? '1' : '0', reply: S.reply ? '1' : '0', rec: S.rec ? '1' : '0', mode: S.mode, menu: S.menu ? '1' : '0', big: S.big ? '1' : '0', hits: S.hits ? '1' : '0', kbm: S.kb ? 'up' : S.focus ? 'back' : 'down' }[k]
  }
  function panelSync() {
    const panel = root.querySelector('.panel')
    if (!panel) return
    for (const b of panel.querySelectorAll('[data-set]')) {
      const [k, v] = b.dataset.set.split('=')
      b.setAttribute('aria-pressed', String(current(k) === v))
    }
    // measured sizes of what you see (visual box, and the ::after hit area where there is one)
    const seen = new Map()
    for (const el of root.querySelectorAll('[data-m]')) {
      const r = el.getBoundingClientRect()
      const after = getComputedStyle(el, '::after')
      const hit = after.content !== 'none' && after.height.endsWith('px') ? Math.max(parseFloat(after.height), 0) : null
      const key = el.dataset.m
      if (!seen.has(key)) seen.set(key, `${key.padEnd(15)} ${r.height.toFixed(0)} × ${r.width.toFixed(0)} px${hit ? ` · hit ${hit.toFixed(0)}` : ''}`)
    }
    root.querySelector('#measure').textContent = [...seen.values()].join('\n') || '—'
    root.querySelector('#measure').style.whiteSpace = 'pre'
    const u = new URLSearchParams({ theme: S.theme, lang: S.lang, w: String(S.w), ctx: S.ctx })
    history.replaceState(null, '', `?${u}`)
  }

  root.innerHTML = '<div class="page"><div class="stage"></div></div>'
  if (!embed) root.querySelector('.page').prepend(buildPanel())
  render()
})()
