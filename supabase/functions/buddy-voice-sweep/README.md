# buddy-voice-sweep

Removes the audio of buddy-read voice messages whose message is gone, and uploads that never became a message, from the private bucket `buddy-voice`.

The database cannot delete a Storage object itself (`storage.protect_delete`), so it queues one (`private.buddy_voice_trash`, by trigger, when a voice message is deleted, becomes a tombstone, or goes with a member who left with "also delete my messages", an account or a read) and asks this function to run (`private.buddy_voice_kick`, pg_net, after the transaction commits; at most once a minute; the pg_cron jobs `sweep-buddy-voice` (hourly, also looks for uploads nobody sent) and `sweep-buddy-voice-queue` (every ten minutes, only when something waits) are the net under it). The function asks `public.buddy_voice_sweep_batch` what may go (the queue, and, on a full run, objects no message points at that are older than 6 hours), removes them through the Storage API and reports `public.buddy_voice_sweep_done`.

Needs (docs/OPERATIONS.md, "Voice messages"):

| Where | Name | What |
| --- | --- | --- |
| function secret | `BUDDY_VOICE_SWEEP_TOKEN` | the bearer the kick carries |
| Vault | `buddy_voice_sweep_token` | the same value |
| database | `private.buddy_voice_settings.function_url` | `https://<ref>.supabase.co/functions/v1/buddy-voice-sweep`; null = off, the queue waits |

`verify_jwt` is off (`supabase/config.toml`); the bearer is the check. Answers: `200 {state, removed, rounds}`, `401`, `405`, `503 not_configured`, `500 failed` (what was not removed is named again by the next run). Tests: `deno task test`.
