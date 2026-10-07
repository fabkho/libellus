/**
 * The `reading-page-og` edge function (issue #171): handler.ts with the real
 * database (the two public functions, asked with the anon key) and the real
 * `fetch` for the covers. README.md says how to run and deploy it.
 *
 * `verify_jwt` is off (supabase/config.toml): the caller is a link-preview
 * crawler by way of web/functions/r/[[path]].js, which has no session. The
 * token in the address is the only thing that opens a page, and the database
 * decides whether it still does.
 */
import { createHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
if (!url || !anonKey) throw new Error('reading-page-og needs SUPABASE_URL and SUPABASE_ANON_KEY')

Deno.serve(createHandler({ supabaseUrl: url, anonKey }))
