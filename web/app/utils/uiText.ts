/**
 * The words the shared UI base says itself (`ui.text` in its `app.config.ts`, its README, "Copy") and the
 * message each one comes from. The base never imports the app's copy; the app keeps `ui.text` current
 * (plugins/ui-text.ts). A word the base adds has to get a line here: tests/ui-text.test.ts reads the base's
 * `app.config.ts` and fails until it has.
 *
 * Keys are the base's paths in `ui.text`, dotted: `cancel`, `chat.reply.you`, `chat.reactions.names.❤️`.
 * The chat's words (`chat.*`) are nested in the base's config and in the message files (`uiText.chat.*`);
 * `uiTextOf` builds the same nesting, so `useUiText().value.chat` can be passed as the chat utils' words.
 */
export const UI_TEXT_KEYS = {
  cancel: 'common.cancel',
  offline: 'common.offline',
  etAl: 'common.etAl',
  'chat.locale': 'uiText.chat.locale',
  'chat.today': 'uiText.chat.today',
  'chat.yesterday': 'uiText.chat.yesterday',
  'chat.loading': 'uiText.chat.loading',
  'chat.offline': 'uiText.chat.offline',
  'chat.olderLoading': 'uiText.chat.olderLoading',
  'chat.olderFailed': 'uiText.chat.olderFailed',
  'chat.olderRetry': 'uiText.chat.olderRetry',
  'chat.read': 'uiText.chat.read',
  'chat.sending': 'uiText.chat.sending',
  'chat.failed': 'uiText.chat.failed',
  'chat.retryHint': 'uiText.chat.retryHint',
  'chat.composer.label': 'uiText.chat.composer.label',
  'chat.composer.placeholder': 'uiText.chat.composer.placeholder',
  'chat.composer.send': 'uiText.chat.composer.send',
  'chat.composer.actions': 'uiText.chat.composer.actions',
  'chat.composer.photo': 'uiText.chat.composer.photo',
  'chat.composer.photoLabel': 'uiText.chat.composer.photoLabel',
  'chat.composer.gif': 'uiText.chat.composer.gif',
  'chat.composer.gifLabel': 'uiText.chat.composer.gifLabel',
  'chat.reply.you': 'uiText.chat.reply.you',
  'chat.reply.voice': 'uiText.chat.reply.voice',
  'chat.reply.gif': 'uiText.chat.reply.gif',
  'chat.reply.photo': 'uiText.chat.reply.photo',
  'chat.reply.gone': 'uiText.chat.reply.gone',
  'chat.reply.bar': 'uiText.chat.reply.bar',
  'chat.reply.cancel': 'uiText.chat.reply.cancel',
  'chat.reply.deleted': 'uiText.chat.reply.deleted',
  'chat.reply.show': 'uiText.chat.reply.show',
  'chat.media.photo': 'uiText.chat.media.photo',
  'chat.media.photoMine': 'uiText.chat.media.photoMine',
  'chat.media.gif': 'uiText.chat.media.gif',
  'chat.media.gifMine': 'uiText.chat.media.gifMine',
  'chat.media.open': 'uiText.chat.media.open',
  'chat.media.loading': 'uiText.chat.media.loading',
  'chat.media.photoRemoved': 'uiText.chat.media.photoRemoved',
  'chat.media.gifRemoved': 'uiText.chat.media.gifRemoved',
  'chat.media.unavailable': 'uiText.chat.media.unavailable',
  'chat.voice.record': 'uiText.chat.voice.record',
  'chat.voice.recording': 'uiText.chat.voice.recording',
  'chat.voice.stopped': 'uiText.chat.voice.stopped',
  'chat.voice.timer': 'uiText.chat.voice.timer',
  'chat.voice.cancel': 'uiText.chat.voice.cancel',
  'chat.voice.send': 'uiText.chat.voice.send',
  'chat.voice.limit': 'uiText.chat.voice.limit',
  'chat.voice.problems.denied': 'uiText.chat.voice.problems.denied',
  'chat.voice.problems.none': 'uiText.chat.voice.problems.none',
  'chat.voice.problems.busy': 'uiText.chat.voice.problems.busy',
  'chat.voice.problems.unsupported': 'uiText.chat.voice.problems.unsupported',
  'chat.voice.problems.failed': 'uiText.chat.voice.problems.failed',
  'chat.voice.bubble.mine': 'uiText.chat.voice.bubble.mine',
  'chat.voice.bubble.theirs': 'uiText.chat.voice.bubble.theirs',
  'chat.voice.bubble.play': 'uiText.chat.voice.bubble.play',
  'chat.voice.bubble.pause': 'uiText.chat.voice.bubble.pause',
  'chat.voice.bubble.loading': 'uiText.chat.voice.bubble.loading',
  'chat.voice.bubble.removed': 'uiText.chat.voice.bubble.removed',
  'chat.voice.bubble.unplayable': 'uiText.chat.voice.bubble.unplayable',
  'chat.voice.bubble.playFailed': 'uiText.chat.voice.bubble.playFailed',
  'chat.voice.bubble.position': 'uiText.chat.voice.bubble.position',
  'chat.gifPicker.title': 'uiText.chat.gifPicker.title',
  'chat.gifPicker.search': 'uiText.chat.gifPicker.search',
  'chat.gifPicker.feedsLabel': 'uiText.chat.gifPicker.feedsLabel',
  'chat.gifPicker.results': 'uiText.chat.gifPicker.results',
  'chat.gifPicker.none': 'uiText.chat.gifPicker.none',
  'chat.gifPicker.more': 'uiText.chat.gifPicker.more',
  'chat.gifPicker.loading': 'uiText.chat.gifPicker.loading',
  'chat.gifPicker.pick': 'uiText.chat.gifPicker.pick',
  'chat.gifPicker.pickTitled': 'uiText.chat.gifPicker.pickTitled',
  'chat.gifPicker.retry': 'uiText.chat.gifPicker.retry',
  'chat.reactions.bar': 'uiText.chat.reactions.bar',
  'chat.reactions.open': 'uiText.chat.reactions.open',
  'chat.reactions.names.❤️': 'uiText.chat.reactions.names.heart',
  'chat.reactions.names.😂': 'uiText.chat.reactions.names.laughing',
  'chat.reactions.names.😮': 'uiText.chat.reactions.names.surprised',
  'chat.reactions.names.😢': 'uiText.chat.reactions.names.sad',
  'chat.reactions.names.🔥': 'uiText.chat.reactions.names.fire',
  'chat.reactions.pick': 'uiText.chat.reactions.pick',
  'chat.reactions.takeBack': 'uiText.chat.reactions.takeBack',
  'chat.reactions.byYou': 'uiText.chat.reactions.byYou',
  'chat.reactions.byOther': 'uiText.chat.reactions.byOther',
  'chat.reactions.byBoth': 'uiText.chat.reactions.byBoth',
  'chat.reactions.byMany': 'uiText.chat.reactions.byMany',
  'chat.reactions.pill': 'uiText.chat.reactions.pill',
  'chat.reactions.copy': 'uiText.chat.reactions.copy',
  'chat.reactions.copied': 'uiText.chat.reactions.copied',
} as const

export type UiTextPath = keyof typeof UI_TEXT_KEYS

/** `ui.text` as the base declares it: a word is a string, the chat's words sit under `chat`. */
export type UiText = { cancel: string; offline: string; etAl: string; chat: Record<string, unknown> } & Record<string, unknown>

/** Sets `value` at a dotted `path` in `target`, creating the nested objects on the way (`chat.reply.you`). */
export const setPath = (target: Record<string, unknown>, path: string, value: string): void => {
  const parts = path.split('.')
  let at = target
  for (const part of parts.slice(0, -1)) {
    at[part] ??= {}
    at = at[part] as Record<string, unknown>
  }
  at[parts[parts.length - 1]!] = value
}

/** The base's words in the language `t` speaks, nested as `ui.text` is. */
export const uiTextOf = (t: (key: string) => string): UiText => {
  const words: Record<string, unknown> = {}
  for (const [path, key] of Object.entries(UI_TEXT_KEYS)) setPath(words, path, t(key))
  return words as UiText
}
