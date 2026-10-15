import type { CollectionEntry } from '@st/shared';
import { tagSet, type Candidate } from '../../collections.js';

/** Which entries may be drawn. Tag lists are compared trimmed and case-insensitively. */
export type DrawFilters = {
  /** The entry must have all of these. */
  requireTags: string[];
  /** When non-empty, the entry must have at least one of these. */
  anyTags: string[];
  /** The entry must have none of these. */
  excludeTags: string[];
  /** When either level bound is set, entries without a level are not eligible. */
  minLevel?: number;
  maxLevel?: number;
};

export type DrawOptions = {
  count: number;
  /** Off: every eligible entry has the same chance. Weight 0 is never drawn either way. */
  useWeights: boolean;
  /** Removes candidates that pass the filters, counted as `excluded` (phase 4: avoid recent draws). */
  isExcluded?: (candidate: Candidate) => boolean;
};

export type DrawResult = {
  drawn: Candidate[];
  /** Candidates that could be drawn: past the filters, weight above 0, not excluded. */
  eligible: number;
  /** Candidates that passed the filters but `isExcluded` removed. */
  excluded: number;
  /** Every candidate looked at (enabled entries with text). */
  considered: number;
};

export function passesFilters(entry: CollectionEntry, filters: DrawFilters): boolean {
  const tags = tagSet(entry.tags);
  if (![...tagSet(filters.requireTags)].every((tag) => tags.has(tag))) return false;
  const any = tagSet(filters.anyTags);
  if (any.size && ![...any].some((tag) => tags.has(tag))) return false;
  if ([...tagSet(filters.excludeTags)].some((tag) => tags.has(tag))) return false;
  if (filters.minLevel === undefined && filters.maxLevel === undefined) return true;
  const { level } = entry;
  if (level === undefined) return false;
  return level >= (filters.minLevel ?? -Infinity) && level <= (filters.maxLevel ?? Infinity);
}

/** Picks one index by cumulative weight from a draw in [0, 1). */
function pickIndex(weights: readonly number[], draw: number): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const target = draw * total;
  let cumulative = 0;
  for (const [index, weight] of weights.entries()) {
    cumulative += weight;
    if (target < cumulative) return index;
  }
  // Guard only: the sums above add the same weights in the same order, and draws stay below 1.
  return weights.length - 1;
}

/**
 * Draws up to `count` candidates without replacement, one `random()` call per pick. Pure: the same
 * candidates, filters and draws always give the same result.
 */
export function drawEntries(
  candidates: readonly Candidate[],
  filters: DrawFilters,
  options: DrawOptions,
  random: () => number,
): DrawResult {
  const filtered = candidates.filter(({ entry }) => passesFilters(entry, filters) && entry.weight > 0);
  const pool = filtered.filter((candidate) => !options.isExcluded?.(candidate));
  const eligible = pool.length;
  const drawn: Candidate[] = [];
  while (drawn.length < options.count && pool.length) {
    const index = pickIndex(
      pool.map(({ entry }) => (options.useWeights ? entry.weight : 1)),
      random(),
    );
    drawn.push(...pool.splice(index, 1));
  }
  return { drawn, eligible, excluded: filtered.length - eligible, considered: candidates.length };
}

const list = (tags: readonly string[]) => [...tagSet(tags)].join(', ');

/** The filters in words, e.g. `tags: forest; level ≤ 2`. */
function describeFilters(filters: DrawFilters, options: { useWeights: boolean }, excluded: number): string[] {
  const { minLevel, maxLevel } = filters;
  return [
    tagSet(filters.requireTags).size ? `tags: ${list(filters.requireTags)}` : '',
    tagSet(filters.anyTags).size ? `any tag: ${list(filters.anyTags)}` : '',
    tagSet(filters.excludeTags).size ? `without: ${list(filters.excludeTags)}` : '',
    minLevel !== undefined && maxLevel !== undefined
      ? minLevel === maxLevel
        ? `level ${minLevel}`
        : `level ${minLevel}–${maxLevel}`
      : minLevel !== undefined
        ? `level ≥ ${minLevel}`
        : maxLevel !== undefined
          ? `level ≤ ${maxLevel}`
          : '',
    options.useWeights ? '' : 'weights off',
    excluded ? `${excluded} recent excluded` : '',
  ].filter(Boolean);
}

/** Why these entries, or why none: `drew 1 of 14 eligible (tags: forest; level ≤ 2)`. */
export function describeDraw(
  result: DrawResult,
  filters: DrawFilters,
  options: { count: number; useWeights: boolean },
): string {
  const parts = describeFilters(filters, options, result.excluded);
  if (!result.drawn.length) {
    const among = `no eligible entry among ${result.considered}`;
    return parts.length ? `${among} (${parts.join('; ')})` : among;
  }
  if (result.drawn.length < options.count) parts.unshift(`asked for ${options.count}`);
  const drew = `drew ${result.drawn.length} of ${result.eligible} eligible`;
  return parts.length ? `${drew} (${parts.join('; ')})` : drew;
}
