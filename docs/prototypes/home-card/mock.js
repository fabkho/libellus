// ?theme=light|dark&lang=en|de: the theme goes on <html data-theme> (as the app does), every element
// with data-en / data-de gets the text of the language (data-*-html for markup).
// The panels set their own width (base.css .phone / .phone.narrow), so there is no ?w= here: a
// panel that proves the 360 px layout carries .narrow itself and stays narrow at any viewport.
const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const lang = params.get('lang') === 'de' ? 'de' : 'en'
document.documentElement.lang = lang
for (const el of document.querySelectorAll('[data-en]')) el.textContent = el.dataset[lang] ?? el.dataset.en
for (const el of document.querySelectorAll('[data-en-html]')) el.innerHTML = el.dataset[`${lang}Html`] ?? el.dataset.enHtml
