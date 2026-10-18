/**
 * Text as a one-line preview: markdown markers (headings, emphasis, list dashes, quotes, code ticks) are dropped and
 * whitespace collapsed, so an item of markdown such as a summary starting "## Scene so far" reads as words wherever
 * it is quoted (the chat panel's collapsed line, the delete dialog, the warning on a turn's chip). The one helper for
 * all of them. Pure.
 */
export function plainPreview(text: string): string {
  return text
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
