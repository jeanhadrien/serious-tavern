import { snippetSchema, type Snippet } from '@st/shared';
import { parseYamlRecord } from './yaml-record.js';
import { YamlRepository, type YamlCodec } from './yaml-repository.js';
import { arrange, toReadableYaml } from './yaml-text.js';

// Human-meaningful keys come first, bookkeeping last; unknown passthrough fields sit in between.
const FIRST = ['name', 'description', 'text'];
const LAST = ['id', 'createdAt', 'updatedAt'];

const snippetCodec: YamlCodec<Snippet> = {
  label: 'snippet',
  fallbackStem: 'snippet',
  parse: (text) => parseYamlRecord(text, snippetSchema, 'snippet'),
  serialize: (snippet) => toReadableYaml(arrange(JSON.parse(JSON.stringify(snippet)), FIRST, LAST), 'Snippet'),
};

/** Snippets (named template text) as YAML files under `data/snippets/` (see `YamlRepository`). */
export class SnippetRepository extends YamlRepository<Snippet> {
  constructor(directory: string) {
    super(directory, snippetCodec);
  }
}
