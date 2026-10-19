/**
 * The words the shared UI base says itself (`ui.text` in its `app.config.ts`, its README, "Copy") and the
 * message each one comes from. The base never imports the app's copy; the app keeps `ui.text` current
 * (plugins/ui-text.ts). A word the base adds has to get a line here: tests/ui-text.test.ts reads the base's
 * `app.config.ts` and fails until it has.
 */
export const UI_TEXT_KEYS = {
  cancel: 'common.cancel',
  offline: 'common.offline',
  etAl: 'common.etAl',
} as const

export type UiText = Record<keyof typeof UI_TEXT_KEYS, string>

/** The base's words in the language `t` speaks. */
export const uiTextOf = (t: (key: string) => string): UiText => ({
  cancel: t(UI_TEXT_KEYS.cancel),
  offline: t(UI_TEXT_KEYS.offline),
  etAl: t(UI_TEXT_KEYS.etAl),
})
