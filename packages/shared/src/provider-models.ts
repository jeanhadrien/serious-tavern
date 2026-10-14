import { z } from 'zod';

/**
 * What the app knows about one model a provider serves. Only `id` is guaranteed; the rest is filled when
 * the backend's `/models` entry carries it (OpenRouter does, plain OpenAI-style entries do not).
 */
export const providerModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  contextLength: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  supportedParameters: z.array(z.string()).optional(),
  // USD per token.
  pricing: z.object({ prompt: z.number().optional(), completion: z.number().optional() }).optional(),
});
export type ProviderModel = z.infer<typeof providerModelSchema>;

/** A provider's model list as the API serves it (cached on the server; `fetchedAt` is an ISO timestamp). */
export const providerModelListSchema = z.object({
  models: z.array(providerModelSchema),
  fetchedAt: z.string(),
});
export type ProviderModelList = z.infer<typeof providerModelListSchema>;

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

/** A positive whole-ish count (context size, token limit); anything else is unknown. */
const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

/**
 * A price in USD per token. Backends send decimal strings ("0.0000025") or numbers; zero is a real price
 * (free models), while negatives (OpenRouter's -1 for variable pricing), blanks and garbage are unknown.
 */
function price(value: unknown): number | undefined {
  const number = typeof value === 'string' ? (value.trim() ? Number(value) : Number.NaN) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : undefined;
}

function normalizeModel(entry: unknown): ProviderModel | undefined {
  if (!isObject(entry)) return undefined;
  const id = text(entry.id);
  if (!id) return undefined;
  const architecture = isObject(entry.architecture) ? entry.architecture : {};
  const topProvider = isObject(entry.top_provider) ? entry.top_provider : {};
  const rawPricing = isObject(entry.pricing) ? entry.pricing : {};
  const pricing = { prompt: price(rawPricing.prompt), completion: price(rawPricing.completion) };
  const hasPricing = pricing.prompt !== undefined || pricing.completion !== undefined;
  const model: ProviderModel = {
    id,
    name: text(entry.name),
    description: text(entry.description),
    contextLength: count(entry.context_length),
    maxOutputTokens: count(topProvider.max_completion_tokens),
    inputModalities: strings(architecture.input_modalities),
    outputModalities: strings(architecture.output_modalities),
    supportedParameters: strings(entry.supported_parameters),
    ...(hasPricing ? { pricing } : {}),
  };
  // Leave unknown facts out entirely, so the result is plain JSON without `undefined` holes.
  return Object.fromEntries(Object.entries(model).filter(([, value]) => value !== undefined)) as ProviderModel;
}

/**
 * Reads the entries of a `GET /models` payload (`{ data: [...] }`, the de facto shape), one generic path for
 * every backend. Entries without a string `id` and repeated ids are skipped; unknown fields are ignored.
 * Returns `undefined` when the payload has no `data` array at all, so callers can tell "no list" from "empty list".
 */
export function normalizeModels(payload: unknown): ProviderModel[] | undefined {
  const data = isObject(payload) ? payload.data : undefined;
  if (!Array.isArray(data)) return undefined;
  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const entry of data) {
    const model = normalizeModel(entry);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}
