/**
 * A book's pages are its publisher's HTML. The reader shows them in frames
 * that run no script of the book's (foliate-js's sandbox allows scripts for
 * its own layout code), so each page loses its scripts before it is shown:
 * `<script>` elements (with content or self-closed) and inline `on…` event
 * handler attributes. Plain text in, plain text out (#131, phase 2).
 */
export function stripScripts(markup: string): string {
  return markup
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}
