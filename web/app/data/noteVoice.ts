import { voiceExtension, voiceMime } from '@fabkho/ui/pure/voice'
import type { VoiceInfo, VoiceJobMedia, VoiceMime } from './buddyVoice'

/**
 * Voice notes, for her own private notes (docs/parity.md, "Notes, a chapter"; the database: supabase/migrations/20261118010000_notes_private_voice.sql).
 * The recording, its limits and the player are the buddy reads' (`data/buddyVoice.ts`: two minutes, 3 MB, a slip of the finger, 48 waveform values; the
 * UI base's recorder and player); what is the notes' own is **where the sound lives** and **who hears it**: the private bucket `note-voice`, whose object
 * of a note is `<author id>/<room id>/<client id>.<m4a|webm|ogg>` (`notePath`, the name `private.note_voice_path` works out), and nobody but its author, ever.
 * Friends and Everyone notes never carry a voice. Nothing here stores a URL: the bubble asks for a signed one, that lives five minutes, when she presses play.
 * Framework-free like every repository here.
 */

export type { VoiceInfo, VoiceJobMedia, VoiceMime }

/** The bucket of a private voice note's sound. */
export const NOTE_VOICE_BUCKET = 'note-voice'

/** The object of a voice note, as the database names it. */
export const notePath = (authorId: string, roomId: string, clientId: string, mime: VoiceMime): string => `${authorId}/${roomId}/${clientId}.${voiceExtension(mime)}`

/** The `voice` of a note in the database's JSON (camelCase, and only in its author's answer). */
export type NoteVoiceJson = { path?: string | null; mime?: string | null; durationMs?: number | null; peaks?: number[] | null }

/** The voice of a note's JSON, or null for a note without one. */
export function voiceFromNoteJson(json: NoteVoiceJson | null | undefined): VoiceInfo | null {
  const mime = voiceMime(json?.mime ?? '')
  if (!json || !mime) return null
  return {
    path: json.path ?? null,
    mime,
    durationMs: Math.max(0, Math.round(Number(json.durationMs ?? 0))),
    peaks: Array.isArray(json.peaks) ? json.peaks.map((p) => Number(p)) : [],
  }
}
