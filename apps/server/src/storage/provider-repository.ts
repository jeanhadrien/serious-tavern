import { stringify } from 'yaml';
import { providerSchema, type Provider } from '@st/shared';
import { parseYamlRecord } from './yaml-record.js';
import { arrange } from './yaml-text.js';
import { YamlRepository, type YamlCodec } from './yaml-repository.js';

// Human-meaningful keys come first, bookkeeping last; unknown passthrough fields sit in between.
const FIRST = [
  'name',
  'kind',
  'baseUrl',
  'secret',
  'headers',
  'messageName',
  'reasoningFields',
  'replayFields',
  'reasoningReplayField',
  'mergeAssistantMessages',
  'extraBody',
  'overrides',
];
const LAST = ['id', 'createdAt', 'updatedAt'];

function serialize(provider: Provider): string {
  const plain = JSON.parse(JSON.stringify(provider)) as Record<string, unknown>;
  return stringify(arrange(plain, FIRST, LAST), { lineWidth: 0, indent: 2 });
}

const providerCodec: YamlCodec<Provider> = {
  label: 'provider',
  fallbackStem: 'provider',
  parse: (text) => parseYamlRecord(text, providerSchema, 'provider'),
  serialize,
};

/** User providers as YAML files under `data/providers/` (see `YamlRepository`). The built-in ones live in code. */
export class ProviderRepository extends YamlRepository<Provider> {
  constructor(directory: string) {
    super(directory, providerCodec);
  }
}
