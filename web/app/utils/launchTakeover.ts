/**
 * The launch takeover (docs/plans/new-logo.md, B; docs/MOTION.md, "Launch takeover").
 *
 * Android (and Chrome, for the shortcut it pins) draws an installed app's launch screen itself: the
 * night room, the icon, the name. The app's first paint draws the same picture — `app/spa-loading-template.html`,
 * which Nuxt puts in the document before any JavaScript runs — so the handover from the system's static
 * splash is invisible, the lamp's glow swells out of the icon into the room, and the frame then leaves
 * as the app arrives. Framework-free so Vitest pins it (tests/launch-takeover.test.ts).
 *
 * Three things decide the path:
 * - the frame is in the document at all: the template is only rendered into a document that is being
 *   loaded now, so the frame's presence *is* the cold start (a page the SPA navigates to has no
 *   document load and no template);
 * - `display-mode: standalone`: the installed app. A browser tab keeps the plain background the
 *   document has always shown (the template hides the frame there), so the takeover is the app's;
 * - `prefers-reduced-motion: reduce`: no swell, a plain crossfade.
 */

export type LaunchTakeover = 'swell' | 'crossfade' | 'none'

export type LaunchFrameState = {
  /** The first-paint frame is in the document: this document was just loaded (a cold start). */
  frame: boolean
  /** `matchMedia('(display-mode: standalone)')`: the installed app, whose launch Android drew. */
  standalone: boolean
  /** `matchMedia('(prefers-reduced-motion: reduce)')`. */
  reducedMotion: boolean
}

/** Which path the frame leaves on: the swell (the glow swells on, then the frame leaves), the crossfade, or none. */
export function launchTakeover({ frame, standalone, reducedMotion }: LaunchFrameState): LaunchTakeover {
  if (!frame || !standalone) return 'none'
  return reducedMotion ? 'crossfade' : 'swell'
}

/**
 * The motion each path's leaving runs on, by token name (`durationToken` / `easingToken` in the UI
 * base's `utils/motion.ts`: JavaScript never carries its own copy of a duration or a curve).
 * The swell is an exit — the frame leaves quickly over `exit` on `exit`; with Reduce Motion it is a
 * crossfade, a state change over `standard`.
 */
export const LAUNCH_TAKEOVER_MOTION = {
  swell: { duration: 'exit', easing: 'exit' },
  crossfade: { duration: 'standard', easing: 'standard' },
} as const
