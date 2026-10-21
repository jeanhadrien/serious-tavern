/**
 * The one tokenizer behind every text metric (words, MTLD, slop, n-grams, sentences). English only.
 *
 * Text is lowercased and NFKC-normalized, and curly apostrophes become `'`. A word is a run of letters and digits that
 * may hold inner apostrophes (`don't`); everything else separates words, so em-dashes, ellipses, hyphens, underscores
 * and Markdown syntax (`*`, `#`, `>`, brackets) never reach a word, while the words inside `*actions*` and quotes stay.
 * Dropped as not being prose: fenced code blocks, link targets (`[text](url)` keeps `text`) and bare URLs.
 */
const FENCED_CODE = /```[\s\S]*?(?:```|$)/g;
const LINK_TARGET = /\]\([^)\s]*\)/g;
const BARE_URL = /\bhttps?:\/\/\S+/g;
const CURLY_APOSTROPHES = /[‘’ʼ]/g;
const WORD = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;
// A sentence ends at ., !, ? or an ellipsis (plus closing quotes or markup) before a space, or at a line break.
const SENTENCE_END = /[.!?]+["')\]*_~]*(?:\s+|$)|\n+/;

/** The text as the metrics read it: normalized, folded, and without code or URLs. */
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(CURLY_APOSTROPHES, "'")
    .replace(FENCED_CODE, ' ')
    .replace(LINK_TARGET, ' ')
    .replace(BARE_URL, ' ');
}

/** The words of a text, in order. */
export function tokenize(text: string): string[] {
  return normalize(text).match(WORD) ?? [];
}

/** The sentences of a text as space-joined words, keeping those of at least `minWords` words (case and punctuation gone). */
export function sentences(text: string, minWords: number): string[] {
  return normalize(text)
    .split(SENTENCE_END)
    .map((sentence) => tokenize(sentence).join(' '))
    .filter((sentence) => sentence.split(' ').length >= minWords);
}
