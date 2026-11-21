/**
 * The reveal of a thread a chapter opens with (`pages/notes/[book]/[chapter].vue`,
 * `pages/together/[id]/[section].vue`; docs/MOTION.md, "A chapter's notes").
 *
 * The thread rises the last `xs` into place and fades in over `standard` on the `standard` curve: the same
 * motion the Profile gives what takes its placeholders' place (`arrive`), and nothing of its own. One motion
 * for the whole thread, whatever it holds: forty notes reveal in the same `standard` that six do.
 *
 * **Keyed on the mount of a thread the store already held** (`useThreadScreen`'s `revealed`). A thread that
 * had to be read arrives after its skeleton with the motion its own arrival already played (`fresh`, the
 * base's `chat-arrive`), and a second animation over those would be one too many. A reload is therefore
 * unchanged: the skeletons, then the messages.
 *
 * **It cannot move the scroll, so it animates the scroller, not the list inside it.** A `translateY` on the
 * thread's `<ol>` adds its `xs` to the scroller's own content (`scrollHeight` grew 4 px for the length of the
 * motion, and the scroller slid those 4 px back as it ended). The scroller's `transform` belongs to the
 * scroller's box, not to its content: measured on the production build, the newest note and `scrollTop` do not
 * move at all while it runs. `opacity` and `transform` only, which lay nothing out; `fill: 'both'` holds the
 * first frame until the animation's first paint, so the thread is never drawn at full strength before it
 * starts.
 *
 * **Reduce Motion.** Nothing travels: the state still arrives, over `quick` (`docs/MOTION.md`, the laws —
 * "every transition finishes at once; the state still changes").
 */

/** The motion's own numbers, from the design's tokens: `xs` and `quick` (design/tokens.json). */
export const THREAD_REVEAL = {
  /** How far it rises: `spacing.xs`. */
  rise: 4,
} as const

/**
 * The thread's own scroller: the base's `.list` (`UiChatThread`'s, the element `scroller` exposes). The list
 * inside it is not the one to animate (see above).
 */
type ThreadElement = { animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => unknown } | null | undefined

/**
 * Plays the reveal on the thread's scroller. `duration` is `durationToken('standard')` — or `quick` with Reduce
 * Motion, which the caller reads — and `easing` `easingToken('standard')`.
 */
export function revealThread(
  thread: ThreadElement,
  { duration, reduced, easing = 'cubic-bezier(0.2, 0, 0, 1)' }: { duration: number; reduced: boolean; easing?: string },
): void {
  if (!thread) return
  const keyframes: Keyframe[] = reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: `translateY(${THREAD_REVEAL.rise}px)` }, { opacity: 1, transform: 'translateY(0)' }]
  thread.animate(keyframes, { duration, easing, fill: 'both' })
}
