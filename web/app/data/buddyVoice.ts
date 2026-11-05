import { checkVoice, voiceExtension, voiceMime, type PreparedVoice, type VoiceLimits, type VoiceMime, type VoiceRejection } from '@fabkho/ui/pure/voice'

/**
 * Voice messages in a buddy read, the rules the app holds a recording to (the database holds the same numbers: supabase/migrations/
 * 20261114020000_buddy_voice.sql). The recording itself, its types (`voiceMime`, `voiceExtension`), the waveform and `checkVoice` are the UI
 * base's (`@fabkho/ui/pure/voice`, plain Node can load it; the recorder and the player are its composables, `useVoiceRecorder` and
 * `useVoicePlayer`, drawn by `UiComposer` and `UiVoiceBubble`). What a recording may be is this app's policy, so the limits live here.
 * Framework-free like every repository here: Vitest drives it in Node and a native port copies it.
 *
 * **Limits.** At most two minutes (`VOICE_MAX_MS`, the database's 120000), at most 3 MB (the bucket's limit; a recording is asked for 48 kbit/s,
 * so two minutes are about 0.7 MB), a slip of the finger shorter than a second is no message, a waveform of at most 48 values.
 *
 * **Where the sound lives.** The private bucket `buddy-voice`; the object of a message is `<read id>/<author id>/<client id>.<m4a|webm|ogg>`
 * (`voicePath`, the same name the database works out: `private.buddy_voice_path`). Nothing here stores a URL: the bubble asks for a signed one,
 * that lives five minutes (`VOICE_URL_SECONDS`), when the member presses play.
 */

/** The longest recording, in milliseconds. The database holds the same number. */
export const VOICE_MAX_MS = 120_000
/** Shorter than this is a slip of the finger, not a message. */
export const VOICE_MIN_MS = 1_000
/** The bucket's limit for an object. */
export const VOICE_MAX_BYTES = 3 * 1024 * 1024
/** The waveform's most values (the database's check). */
export const VOICE_MAX_PEAKS = 48
/** How long the URL of a recording lives, in seconds; the app asks for a new one after `VOICE_URL_REUSE_MS`. */
export const VOICE_URL_SECONDS = 300
/** A URL signed this long ago is asked for again (a minute of margin before it dies). */
export const VOICE_URL_REUSE_MS = (VOICE_URL_SECONDS - 60) * 1000
export const VOICE_BUCKET = 'buddy-voice'

/** What `checkVoice` holds a finished recording to. */
export const VOICE_LIMITS: VoiceLimits = { minMs: VOICE_MIN_MS, maxBytes: VOICE_MAX_BYTES }

export type { PreparedVoice, VoiceMime }

/** The voice message of a row: its type, how long it plays and its waveform. `path` is the object's name (never a URL). */
export type VoiceInfo = { path: string | null; mime: VoiceMime; durationMs: number; peaks: number[] }

/** What a send carries once the recording is stored: the type, the length and the waveform. */
export type VoiceJobMedia = { mime: VoiceMime; durationMs: number; peaks: number[] }

/** The object of a voice message, as the database names it. */
export const voicePath = (readId: string, authorId: string, clientId: string, mime: VoiceMime): string =>
  `${readId}/${authorId}/${clientId}.${voiceExtension(mime)}`

/** The type an object's name says (`.m4a` is `audio/mp4`), or null for a name that is none of the three. */
export function mimeOfPath(path: string | null): VoiceMime | null {
  const ext = /\.(m4a|webm|ogg)$/.exec(path ?? '')?.[1]
  return ext === 'm4a' ? 'audio/mp4' : ext === 'webm' ? 'audio/webm' : ext === 'ogg' ? 'audio/ogg' : null
}

/** The waveform a recording sends: whole numbers 0 - 100, at most 48 of them (a longer one is thinned evenly), none when there is none. */
export function sendablePeaks(peaks: readonly number[]): number[] {
  const clean = peaks.map((p) => Math.min(100, Math.max(0, Math.round(Number.isFinite(p) ? p : 0))))
  if (clean.length <= VOICE_MAX_PEAKS) return clean
  return Array.from({ length: VOICE_MAX_PEAKS }, (_, i) => clean[Math.floor((i * clean.length) / VOICE_MAX_PEAKS)]!)
}

/** A finished recording as the send takes it, or why it is not sent (the app words the reason). */
export type PreparedForSend = { ok: true; mime: VoiceMime; durationMs: number; peaks: number[] } | { ok: false; reason: VoiceRejection }

export function prepareVoice(voice: Pick<PreparedVoice, 'blob' | 'durationMs' | 'peaks'>): PreparedForSend {
  const reason = checkVoice(voice.blob, voice.durationMs, VOICE_LIMITS)
  if (reason) return { ok: false, reason }
  // `checkVoice` has seen the type: it is one of the three.
  return { ok: true, mime: voiceMime(voice.blob.type)!, durationMs: Math.min(Math.round(voice.durationMs), VOICE_MAX_MS), peaks: sendablePeaks(voice.peaks) }
}

type VoiceJson = { path?: string | null; mime?: string | null; duration_ms?: number | null; peaks?: number[] | null }

/**
 * The voice object of a row (`voice` of `buddy_read_messages` and `send_buddy_voice`, or of a live `message.new`, which has no `path`: the
 * app works the object's name out from the ids in the payload), or null for a message that is not a voice message.
 */
export function voiceFromJson(json: VoiceJson | null | undefined, ids: { readId: string; authorId: string | null; clientId: string | null }): VoiceInfo | null {
  const mime = voiceMime(json?.mime ?? '')
  if (!json || !mime) return null
  const derived = ids.authorId && ids.clientId ? voicePath(ids.readId, ids.authorId, ids.clientId, mime) : null
  return {
    path: json.path ?? derived,
    mime,
    durationMs: Math.max(0, Math.round(Number(json.duration_ms ?? 0))),
    peaks: Array.isArray(json.peaks) ? json.peaks.map((p) => Number(p)) : [],
  }
}
