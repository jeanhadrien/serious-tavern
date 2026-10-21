import slopList from './slop_list.json' with { type: 'json' };

/** MTLD's standard TTR threshold (McCarthy & Jarvis 2010). */
const MTLD_THRESHOLD = 0.72;

/** Below this many words MTLD is not computed: its factor count is too noisy on shorter texts. */
const MIN_MTLD_TOKENS = 50;

/** The n-gram size of the overlap metric, stopwords kept. */
const NGRAM_SIZE = 4;

/** Sentences shorter than this are never matched, so "Yes." or "I see." cannot count as recycled. */
export const MIN_SENTENCE_WORDS = 4;

const SLOP_WORDS = new Set(slopList.map(([word]) => word));

/** Factors of one MTLD pass: how many times the running type-token ratio fell to the threshold, plus a partial factor. */
function mtldFactors(tokens: string[]): number {
  let factors = 0;
  let types = new Set<string>();
  let length = 0;
  for (const token of tokens) {
    types.add(token);
    length += 1;
    if (types.size / length <= MTLD_THRESHOLD) {
      factors += 1;
      types = new Set();
      length = 0;
    }
  }
  // The leftover stretch counts in proportion to how far its ratio got toward the threshold.
  if (length > 0) factors += (1 - types.size / length) / (1 - MTLD_THRESHOLD);
  return factors;
}

/**
 * MTLD: the mean of the forward and backward passes, each `tokens / factors`. `null` under `MIN_MTLD_TOKENS` words,
 * and when a pass finds no factor at all (every word new, so the ratio never fell).
 */
export function mtld(tokens: string[]): number | null {
  if (tokens.length < MIN_MTLD_TOKENS) return null;
  const forward = mtldFactors(tokens);
  const backward = mtldFactors([...tokens].reverse());
  if (forward === 0 || backward === 0) return null;
  return (tokens.length / forward + tokens.length / backward) / 2;
}

/** How many of the tokens are in the slop word list (a raw count, not a rate). */
export function countSlop(tokens: string[]): number {
  return tokens.filter((token) => SLOP_WORDS.has(token)).length;
}

/** Every 4-gram instance of the tokens, as space-joined strings. */
export function fourGrams(tokens: string[]): string[] {
  const grams: string[] = [];
  for (let start = 0; start + NGRAM_SIZE <= tokens.length; start += 1) {
    grams.push(tokens.slice(start, start + NGRAM_SIZE).join(' '));
  }
  return grams;
}
