import { parse, stringify } from 'yaml';
import { providerSchema, type Provider } from '@st/shared';
import { YamlRepository, type ParsedYaml, type YamlCodec } from './yaml-repository.js';

// Human-meaningful keys come first, bookkeeping last; unknown passthrough fields sit in between.
const FIRST = [
  'name',
  'kind',
  'baseUrl',
  'secret',
  'headers',
  'messageName',
  'reasoningFields',
  'extraBody',
  'overrides',
];
const LAST = ['id', 'createdAt', 'updatedAt'];
const STAMPED = ['id', 'createdAt', 'updatedAt'];
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

function serialize(provider: Provider): string {
  const plain = JSON.parse(JSON.stringify(provider)) as Record<string, unknown>;
  const keys = Object.keys(plain);
  const ordered = [
    ...FIRST.filter((key) => key in plain),
    ...keys.filter((key) => !FIRST.includes(key) && !LAST.includes(key)),
    ...LAST.filter((key) => key in plain),
  ];
  return stringify(Object.fromEntries(ordered.map((key) => [key, plain[key]])), { lineWidth: 0, indent: 2 });
}

/** Parses and validates file text. Flags a structurally valid file that only lacks id/timestamps. */
function parseProvider(text: string): ParsedYaml<Provider> {
  let raw: unknown;
  try {
    raw = parse(text, { logLevel: 'error' });
  } catch (error) {
    return { ok: false, reason: `invalid YAML: ${(error as Error).message}` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, reason: 'top level must be a mapping' };
  const candidate = raw as Record<string, unknown>;
  const parsed = providerSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, item: parsed.data };
  const stamped = providerSchema.safeParse({
    createdAt: 'x',
    updatedAt: 'x',
    ...Object.fromEntries(Object.entries(candidate).filter(([, value]) => value != null)),
    // Only a missing id is stamped; a present but invalid one (not a UUID) makes the file invalid.
    ...(candidate.id == null ? { id: PLACEHOLDER_ID } : {}),
  });
  if (stamped.success && STAMPED.some((key) => candidate[key] == null))
    return { ok: false, reason: 'missing id or timestamps', needsStamp: true };
  const issue = parsed.error.issues[0];
  return { ok: false, reason: `invalid provider: ${issue?.path.join('.') || '(root)'}: ${issue?.message}` };
}

const providerCodec: YamlCodec<Provider> = {
  label: 'provider',
  fallbackStem: 'provider',
  parse: parseProvider,
  serialize,
};

/** User providers as YAML files under `data/providers/` (see `YamlRepository`). The built-in ones live in code. */
export class ProviderRepository extends YamlRepository<Provider> {
  constructor(directory: string) {
    super(directory, providerCodec);
  }
}
