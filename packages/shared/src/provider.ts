import { z } from 'zod';

/** Wire protocols a provider record can speak. Only OpenAI-compatible chat completions for now. */
export const providerKinds = ['openai-compatible'] as const;

const wireName = z.string().min(1);
const secretName = z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Secret names use letters, digits, "_" and "-"');

/**
 * Replaces fields of the provider for models whose id matches `match` (a glob, `*` is the only wildcard).
 * The first matching override wins; `headers` and `extraBody` are shallow-merged over the provider's.
 */
export const providerOverrideSchema = z
  .object({
    match: z.string().min(1),
    messageName: wireName.nullable().optional(),
    reasoningFields: z.array(wireName).optional(),
    replayFields: z.array(wireName).optional(),
    reasoningReplayField: wireName.nullable().optional(),
    mergeAssistantMessages: z.boolean().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    extraBody: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type ProviderOverride = z.infer<typeof providerOverrideSchema>;

// Provider records keep unknown fields on round-trips; new optional fields must use .default()/.optional().
/** What a client writes: everything but identity and timestamps. */
export const providerFieldsSchema = z
  .object({
    name: z.string().trim().min(1),
    kind: z.enum(providerKinds).default('openai-compatible'),
    // Requests go to `<baseUrl>/chat/completions`.
    baseUrl: z
      .string()
      .trim()
      .url()
      .refine((value) => /^https?:\/\//i.test(value), 'Base URL must start with http:// or https://'),
    // Name of a secret in the encrypted store. Optional: local servers need none.
    secret: secretName.optional(),
    headers: z.record(z.string(), z.string()).default({}),
    // Wire field carrying a message's name; null means the name is never sent.
    messageName: wireName.nullable().default('name'),
    // Fields read from a stream delta / response message for the reasoning trace; the first non-empty one wins.
    reasoningFields: z.array(wireName).default(['reasoning', 'reasoning_content']),
    // Message-level fields of a response that the backend needs back on later requests (OpenRouter's
    // `reasoning_details`). Kept in the message's `provider_data` and sent back as they are.
    replayFields: z.array(wireName).default([]),
    // Wire field a message's `reasoning` is sent back under; null means reasoning is never sent.
    reasoningReplayField: wireName.nullable().default(null),
    // Join consecutive assistant messages (without tool calls) into one before sending, for backends that refuse them.
    mergeAssistantMessages: z.boolean().default(false),
    // Merged into the request body last.
    extraBody: z.record(z.string(), z.unknown()).default({}),
    overrides: z.array(providerOverrideSchema).default([]),
  })
  .passthrough();
export type ProviderFields = z.input<typeof providerFieldsSchema>;

/** A stored user provider (`data/providers/*.yaml`). The built-in ones are `builtInProviders`. */
export const providerSchema = providerFieldsSchema
  .extend({ id: z.string().uuid(), createdAt: z.string(), updatedAt: z.string() })
  .passthrough();
export type Provider = z.infer<typeof providerSchema>;

/** A provider as the API lists it: stored or built-in (`builtIn`, read-only, with a readable id). */
export const providerViewSchema = providerFieldsSchema
  .extend({ id: z.string().min(1), createdAt: z.string(), updatedAt: z.string(), builtIn: z.boolean() })
  .passthrough();
export type ProviderView = z.infer<typeof providerViewSchema>;

const builtInDate = '1970-01-01T00:00:00.000Z';
/**
 * Read-only providers shipped in code, so fixes reach every install. OpenRouter keeps the id and secret
 * that existing `provider: 'openrouter'` nodes already use. Users duplicate one to customize it.
 */
export const builtInProviders: readonly Provider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    secret: 'openrouter',
    headers: { 'HTTP-Referer': 'https://github.com/serious-tavern', 'X-Title': 'Serious Tavern' },
    messageName: 'name',
    reasoningFields: ['reasoning', 'reasoning_content'],
    replayFields: ['reasoning_details'],
    reasoningReplayField: 'reasoning',
    mergeAssistantMessages: false,
    extraBody: {},
    overrides: [],
    createdAt: builtInDate,
    updatedAt: builtInDate,
  },
  // https://docs.abliteration.ai: accepts message names and OpenRouter's `reasoning` object; returns
  // reasoning as `reasoning_content`. Its request schema rejects unknown fields, so keep `extraBody` empty.
  {
    id: 'abliteration',
    name: 'abliteration.ai',
    kind: 'openai-compatible',
    baseUrl: 'https://api.abliteration.ai/v1',
    secret: 'abliteration',
    headers: {},
    messageName: 'name',
    reasoningFields: ['reasoning_content', 'reasoning'],
    replayFields: [],
    reasoningReplayField: null,
    mergeAssistantMessages: false,
    extraBody: {},
    overrides: [],
    createdAt: builtInDate,
    updatedAt: builtInDate,
  },
];

export const findBuiltInProvider = (id: string): Provider | undefined =>
  builtInProviders.find((provider) => provider.id === id);
