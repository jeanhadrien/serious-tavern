import { jaccard, ngrams, properNames, tokenize } from '../../text-similarity.js';

export type StagnationParams = {
  /** The replies' texts, oldest first; the last one is the newest. */
  replies: readonly string[];
  ngram: number;
  repetitionWeight: number;
  churnWeight: number;
  /** The average n-gram overlap that counts as fully repetitive. */
  repetitionFull: number;
  /** Lowercased names that are always in the story (character, persona, speakers): never "new". */
  cast: ReadonlySet<string>;
};

export type Stagnation = {
  /** 0..1, 1 = very stagnant. */
  score: number;
  /** Average n-gram Jaccard overlap of consecutive replies, 0..1 (raw, not scaled). */
  repetition: number;
  /** Share of the newest reply's names the earlier replies did not mention, 0..1; 1 when it names nobody. */
  novelty: number;
  names: { total: number; fresh: number };
  reason: string;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const fmt = (value: number) => String(Number(value.toFixed(2)));

/** Names of the cast, lowercased and split into words, so "Mira Vance" excludes both "mira" and "vance". */
export function castNames(...names: (string | undefined)[]): Set<string> {
  return new Set(names.flatMap((name) => (name ? tokenize(name) : [])));
}

/**
 * How stuck the last replies are. Two measures, both on the same window:
 * - repetition: the mean word n-gram Jaccard overlap between each pair of consecutive replies (pairs too short to have
 *   n-grams are left out), scaled by `repetitionFull` (overlap at or above it counts as 1);
 * - churn: the share of the newest reply's proper names that no earlier reply of the window mentions. Few new names
 *   means stagnant, so the score uses `1 - novelty`.
 * score = (repetitionWeight × scaled repetition + churnWeight × (1 - novelty)) / (both weights). A newest reply with
 * no names (or text without capital letters) has nothing to judge: the score is then the scaled repetition alone.
 * Fewer than 2 replies score 0.
 */
export function measureStagnation(params: StagnationParams): Stagnation {
  const { replies, ngram, repetitionWeight, churnWeight, repetitionFull, cast } = params;
  if (replies.length < 2) {
    return {
      score: 0,
      repetition: 0,
      novelty: 1,
      names: { total: 0, fresh: 0 },
      reason: `needs at least 2 assistant replies, found ${replies.length}: stagnation 0`,
    };
  }
  const tokens = replies.map(tokenize);
  const grams = tokens.map((list) => ngrams(list, ngram));
  const overlaps: number[] = [];
  for (let at = 1; at < grams.length; at++)
    if (grams[at - 1]!.length && grams[at]!.length) overlaps.push(jaccard(grams[at - 1]!, grams[at]!));
  const repetition = overlaps.length ? overlaps.reduce((sum, value) => sum + value, 0) / overlaps.length : 0;
  const scaled = clamp01(repetition / repetitionFull);

  // Sentence-initial capitals count as names only when some reply of the window also uses them inside a sentence.
  const known = new Set(replies.flatMap((text) => [...properNames(text, { exclude: cast })]));
  const newest = properNames(replies.at(-1)!, { exclude: cast, known });
  const earlier = new Set(tokens.slice(0, -1).flat());
  const fresh = [...newest].filter((name) => !earlier.has(name)).length;
  const novelty = newest.size ? fresh / newest.size : 1;

  const churn = churnWeight > 0 && newest.size > 0;
  const weight = repetitionWeight + (churn ? churnWeight : 0);
  const score = clamp01(
    weight > 0 ? (repetitionWeight * scaled + (churn ? churnWeight * (1 - novelty) : 0)) / weight : 0,
  );
  const overlap = overlaps.length
    ? `${ngram}-gram overlap ${fmt(repetition)} across last ${replies.length} replies`
    : `no ${ngram}-gram overlap to measure across last ${replies.length} replies (too short)`;
  const names = newest.size
    ? `${fresh} new name${fresh === 1 ? '' : 's'} of ${newest.size}`
    : 'no names in the newest reply';
  return {
    score,
    repetition,
    novelty,
    names: { total: newest.size, fresh },
    reason: `${overlap}; ${names}: stagnation ${fmt(score)}`,
  };
}
