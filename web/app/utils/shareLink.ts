/**
 * Handing a link to the platform (issue #171: a reading page, a Book card).
 * Where there is a share sheet (phones, Safari) it opens with the link; where
 * there is none (most desktop browsers) the link is copied instead. Copy is
 * also its own action. Framework-free, the browser's pieces passed in, so a
 * test drives it without a browser.
 */

/** What became of the link: shared, copied, the sheet dismissed, or nothing worked. */
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

export type ShareTarget = {
  share?: (data: { url: string; title?: string; text?: string }) => Promise<void>
  canShare?: (data: { url: string; title?: string; text?: string }) => boolean
  clipboard?: { writeText: (text: string) => Promise<void> }
}

export async function copyLink(url: string, target: ShareTarget): Promise<ShareOutcome> {
  try {
    if (!target.clipboard) return 'failed'
    await target.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}

export async function shareLink(link: { url: string; title?: string; text?: string }, target: ShareTarget): Promise<ShareOutcome> {
  if (target.share && (!target.canShare || target.canShare(link))) {
    try {
      await target.share(link)
      return 'shared'
    } catch (error) {
      // Dismissed: nothing else to do. Anything else (not allowed here): the clipboard.
      if ((error as { name?: string } | null)?.name === 'AbortError') return 'cancelled'
    }
  }
  return copyLink(link.url, target)
}
