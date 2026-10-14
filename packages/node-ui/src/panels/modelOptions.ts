import type { ProviderModel } from '@st/shared';

/** Pure logic of the model picker: filtering and the short facts shown next to each option. */

/** Rendering hundreds of options (OpenRouter lists ~460) is noise; the rest is reached by typing. */
export const maxShownModels = 50;

/**
 * Models whose id or name contains every whitespace-separated term of `query` (case-insensitive), in list
 * order, capped at `limit`. `total` counts all matches so the UI can say how many are hidden.
 */
export function filterModels(models: readonly ProviderModel[], query: string, limit = maxShownModels) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = models.filter((model) => {
    const haystack = `${model.id} ${model.name ?? ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  return { shown: matches.slice(0, limit), total: matches.length };
}

/** Whether `id` is exactly one of the listed models (free text may be anything else). */
export const isListed = (models: readonly ProviderModel[], id: string) => models.some((model) => model.id === id);

// Up to three significant digits, no trailing zeros: 2.5, 0.15, 10, 1500.
const compact = (value: number) => String(Number.parseFloat(value.toPrecision(3)));

/** A token count as `8k`, `131k`, `1M`. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${compact(count / 1_000_000)}M`;
  if (count >= 1000) return `${Math.round(count / 1000)}k`;
  return String(count);
}

/** Prices are USD per token; people compare per million tokens: `$2.5 in / $10 out per 1M`, or `free`. */
export function formatPricing(pricing: ProviderModel['pricing']): string | undefined {
  if (!pricing) return undefined;
  const { prompt, completion } = pricing;
  if (prompt === 0 && completion === 0) return 'free';
  const perMillion = (price: number, label: string) => `$${compact(price * 1_000_000)} ${label}`;
  const parts = [
    ...(prompt === undefined ? [] : [perMillion(prompt, 'in')]),
    ...(completion === undefined ? [] : [perMillion(completion, 'out')]),
  ];
  return parts.length ? `${parts.join(' / ')} per 1M` : undefined;
}

/** The facts an option shows after its name: context size and price, when known. */
export function modelFacts(model: ProviderModel): string {
  return [
    model.contextLength === undefined ? undefined : `${formatTokens(model.contextLength)} ctx`,
    formatPricing(model.pricing),
  ]
    .filter(Boolean)
    .join(' · ');
}
