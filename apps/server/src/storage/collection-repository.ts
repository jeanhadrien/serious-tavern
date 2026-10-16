import { collectionSchema, type Collection } from '@st/shared';
import { parseYamlRecord } from './yaml-record.js';
import { YamlRepository, type YamlCodec } from './yaml-repository.js';
import { arrange, toReadableYaml, isObj } from './yaml-text.js';

type Obj = Record<string, unknown>;

// Human-meaningful keys come first, bookkeeping last; unknown passthrough fields sit in between.
const FIRST = ['name', 'description', 'entries'];
const LAST = ['id', 'createdAt', 'updatedAt'];
const ENTRY_FIRST = ['title', 'text', 'keywords', 'tags', 'level', 'weight', 'enabled'];

/**
 * Serializes a collection to readable YAML (multi-line text as literal blocks). Default entry values
 * (`weight: 1`, `enabled: true`) are left out so a save does not add noise to a hand-written file; reading
 * the file back applies them again.
 */
function serialize(collection: Collection): string {
  const plain = JSON.parse(JSON.stringify(collection)) as Obj;
  const entries = Array.isArray(plain.entries) ? plain.entries : [];
  plain.entries = entries.map((entry) => {
    if (!isObj(entry)) return entry;
    const { weight, enabled, ...rest } = entry;
    return arrange({ ...rest, ...(weight !== 1 && { weight }), ...(enabled !== true && { enabled }) }, ENTRY_FIRST);
  });
  return toReadableYaml(arrange(plain, FIRST, LAST), 'Collection');
}

const collectionCodec: YamlCodec<Collection> = {
  label: 'collection',
  fallbackStem: 'collection',
  parse: (text) => parseYamlRecord(text, collectionSchema, 'collection'),
  serialize,
};

/** Authored collections (lorebooks and decks) as YAML files under `data/collections/` (see `YamlRepository`). */
export class CollectionRepository extends YamlRepository<Collection> {
  constructor(directory: string) {
    super(directory, collectionCodec);
  }
}
