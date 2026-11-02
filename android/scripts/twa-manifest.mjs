// Writes android/twa-manifest.json, the input of Bubblewrap (docs/ANDROID.md), from the one place
// the app's address lives: android/origin.txt. `node scripts/twa-manifest.mjs` (regenerate.sh runs it).
//
// The rest mirrors web/nuxt.config.ts's manifest (shortcuts, share target, colours): a change there
// that the shell carries is made here too. The package id is not final until a Play release.
import { readFileSync, writeFileSync } from 'node:fs'

const dir = new URL('../', import.meta.url)
const origin = (process.env.ORIGIN ?? readFileSync(new URL('origin.txt', dir), 'utf8')).trim().replace(/\/+$/, '')
const host = new URL(origin).host

// The version stays in the file once it exists: appVersionCode counts up per release (regenerate.sh --bump).
let previous = {}
try { previous = JSON.parse(readFileSync(new URL('twa-manifest.json', dir), 'utf8')) } catch { /* first run */ }

const NIGHT = '#0E0C0A' // design/tokens.json color.surface.dark, the web manifest's background_color
const shortcut = (name, shortName, path, icon) => ({
  name,
  shortName,
  url: `${origin}${path}`,
  chosenIconUrl: `${origin}/shortcut-${icon}-96.png`,
  chosenMaskableIconUrl: `${origin}/shortcut-${icon}-96.png`,
})

const manifest = {
  packageId: 'de.betterreads.app',
  host,
  name: 'BetterReads',
  launcherName: 'BetterReads',
  display: 'standalone',
  // The status bar and the navigation bar are the night room: the page's own theme-color takes the
  // status bar over once it loads; the navigation bar follows the room per appearance.
  themeColor: NIGHT,
  themeColorDark: NIGHT,
  navigationColor: '#F4F0E9',
  navigationColorDark: NIGHT,
  navigationDividerColor: '#F4F0E9',
  navigationDividerColorDark: NIGHT,
  backgroundColor: NIGHT,
  enableNotifications: false,
  startUrl: '/',
  iconUrl: `${origin}/icon-512.png`,
  maskableIconUrl: `${origin}/icon-maskable-512.png`,
  monochromeIconUrl: `${origin}/icon-monochrome-512.png`,
  splashScreenFadeOutDuration: 300,
  signingKey: { path: '~/.android-keys/betterreads-upload.jks', alias: 'betterreads-upload' },
  appVersion: previous.appVersion ?? '0.1.0',
  appVersionCode: previous.appVersionCode ?? 1,
  shortcuts: [
    shortcut('Search', 'Search', '/?search=1', 'search'),
    shortcut('Update progress', 'Progress', '/?progress=1', 'progress'),
    shortcut('Library', 'Library', '/library', 'library'),
  ],
  generatorApp: 'bubblewrap-cli',
  webManifestUrl: `${origin}/manifest.webmanifest`,
  // Without a vouching assetlinks.json the app still opens, as a Custom Tab with the URL bar.
  fallbackType: 'customtabs',
  features: {},
  alphaDependencies: { enabled: false },
  // On, though the PWA has no use for it: androidbrowserhelper 2.7.4 (what Bubblewrap 1.27 pins) calls
  // ManageDataLauncherActivity.setComponentEnabledSetting on every launch and crashes with "Component class ...
  // ManageDataLauncherActivity does not exist" when the manifest does not declare the activity. With it, Chrome's
  // site settings are Android's "Storage > Manage space" (and, where Chrome supports it, a fourth long-press
  // shortcut: Chrome 156 on the emulator offers none).
  enableSiteSettingsShortcut: true,
  isChromeOSOnly: false,
  isMetaQuest: false,
  fullScopeUrl: `${origin}/`,
  // Adaptive icons, vector drawables and the Android 12 splash are drawn from API 26: older phones are not a target.
  minSdkVersion: 26,
  // The web manifest's share_target, as it is: text and links open /share, EPUB files are taken in (sw-share.js).
  shareTarget: {
    action: `${origin}/share`,
    method: 'POST',
    enctype: 'multipart/form-data',
    params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'ebooks', accept: ['.epub', 'application/epub+zip'] }] },
  },
  // The web manifest has no orientation: the app turns with the phone.
  orientation: 'default',
  fingerprints: [],
  additionalTrustedOrigins: [],
  retainedBundles: [],
  protocolHandlers: [],
  fileHandlers: [],
  launchHandlerClientMode: '',
  displayOverride: [],
}

writeFileSync(new URL('twa-manifest.json', dir), JSON.stringify(manifest, null, 2) + '\n')
console.log(`twa-manifest.json for ${origin} (package ${manifest.packageId}, version ${manifest.appVersion} / ${manifest.appVersionCode})`)
