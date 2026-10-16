import { stateDefinitionSchema, type StateDefinition } from '@st/shared';
import { parseYamlRecord } from './yaml-record.js';
import { YamlRepository, type YamlCodec } from './yaml-repository.js';
import { arrange, toReadableYaml, isObj } from './yaml-text.js';

type Obj = Record<string, unknown>;

// Human-meaningful keys come first, bookkeeping last; unknown passthrough fields sit in between.
const FIRST = ['name', 'description', 'keys'];
const LAST = ['id', 'createdAt', 'updatedAt'];
const KEY_FIRST = ['type', 'default', 'min', 'max', 'options', 'cap', 'fields'];

/** Serializes a definition to readable YAML: the name first, each key's `type` first, ids last. */
function serialize(definition: StateDefinition): string {
  const plain = JSON.parse(JSON.stringify(definition)) as Obj;
  if (isObj(plain.keys))
    plain.keys = Object.fromEntries(
      Object.entries(plain.keys).map(([key, def]) => [key, isObj(def) ? arrange(def, KEY_FIRST) : def]),
    );
  return toReadableYaml(arrange(plain, FIRST, LAST), 'State definition');
}

const stateDefinitionCodec: YamlCodec<StateDefinition> = {
  label: 'state definition',
  fallbackStem: 'definition',
  parse: (text) => parseYamlRecord(text, stateDefinitionSchema, 'state definition'),
  serialize,
};

/** State definitions as YAML files under `data/state/definitions/` (see `YamlRepository`). */
export class StateDefinitionRepository extends YamlRepository<StateDefinition> {
  constructor(directory: string) {
    super(directory, stateDefinitionCodec);
  }
}
