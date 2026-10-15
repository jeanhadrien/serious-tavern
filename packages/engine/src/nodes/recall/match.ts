export type MatchOptions = { caseSensitive: boolean; wholeWords: boolean };

// Scripts written without spaces between words (Chinese, Japanese, Thai…): they have no word boundaries, so
// a keyword edge in one of them needs none, and one of their letters next to a keyword never blocks it
// (`東京` in `私は東京に行く`, `Tokyo` in `私はTokyoに行く`).
const UNSPACED =
  '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Thai}\\p{Script=Lao}\\p{Script=Khmer}\\p{Script=Myanmar}';
// Letters, marks and digits of any spaced script, plus `_`: what a word is made of for whole-word matching.
const WORD = `(?![${UNSPACED}])[\\p{L}\\p{M}\\p{N}_]`;
const WORD_CHAR = new RegExp(`^${WORD}$`, 'u');
const BEFORE = `(?<!${WORD})`;
const AFTER = `(?!${WORD})`;

// Only syntax characters: the `u` flag rejects needless escapes such as `\-`.
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A matcher for one keyword, or null for a blank one. Keywords are literal text (regex characters match
 * themselves). With `wholeWords`, a side of the keyword only needs a word boundary when its edge character
 * is a word character, so `C++` and `#tag` still match; boundaries understand every script (`Борин` does
 * not match inside `Борина`), and scripts written without spaces never count as word characters.
 */
export function keywordMatcher(keyword: string, options: MatchOptions): RegExp | null {
  const literal = keyword.trim();
  if (!literal) return null;
  let source = escapeRegExp(literal);
  if (options.wholeWords) {
    const chars = [...literal];
    if (WORD_CHAR.test(chars[0]!)) source = BEFORE + source;
    if (WORD_CHAR.test(chars.at(-1)!)) source += AFTER;
  }
  return new RegExp(source, options.caseSensitive ? 'u' : 'iu');
}

/** True when any matcher finds its keyword in one of the texts. Each text is searched on its own. */
export const anyMatch = (matchers: readonly RegExp[], texts: readonly string[]) =>
  matchers.some((matcher) => texts.some((text) => matcher.test(text)));
