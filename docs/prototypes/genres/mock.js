// ?theme=light|dark&lang=en|de: the theme goes on <html data-theme> (as the app does), every element
// with data-en / data-de gets the text of the language (data-*-html for markup).
const params = new URLSearchParams(location.search)
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const lang = params.get('lang') === 'de' ? 'de' : 'en'
document.documentElement.lang = lang
for (const el of document.querySelectorAll('[data-en]')) el.textContent = el.dataset[lang] ?? el.dataset.en
for (const el of document.querySelectorAll('[data-en-html]')) el.innerHTML = el.dataset[`${lang}Html`] ?? el.dataset.enHtml
if (params.get('w') === '360') document.querySelector('.phone')?.classList.add('narrow')
