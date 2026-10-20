import type { StateDefinition, StateKeyDef, StateKeyType } from '@st/shared';
import { classifyDraftChange } from '../draftChange.js';
import type { DiskChange } from '../fileLiveSync.js';
import { compile } from './definitionCompile.js';
import { fieldsText, numberText, objectText, optionsText } from './keyFields.js';

/**
 * One key row of the editor. Every value is text, so a half-typed number is never lost; `compile` turns the
 * draft into a request body.
 */
export interface KeyDraft {
  /** Local React key, not saved: typing a key's name must not remount its row. */
  uid: string;
  name: string;
  type: StateKeyType;
  /** What the key is for; shown to the model by the LLM node's state tools. */
  description: string;
  /** Number text, `true`/`false`/'' for a boolean, an option for an enum, text, or object JSON. */
  default: string;
  min: string;
  max: string;
  /** Enum options, one per line. */
  options: string;
  /** Collection cap. */
  cap: string;
  /** Collection item fields, `name:type` per line. */
  fields: string;
  /** Properties of the stored key that the form does not edit (unknown ones, an object's `schema`): sent back as is. */
  rest: Record<string, unknown>;
}

/**
 * What the editor edits. Top-level fields it does not show are not part of it: the server keeps them on update.
 */
export interface DefinitionDraft {
  name: string;
  description: string;
  keys: KeyDraft[];
}

/** The properties the form edits for each key type; everything else of a stored key goes to `rest`. */
const KNOWN: Record<StateKeyType, readonly string[]> = {
  number: ['type', 'description', 'default', 'min', 'max'],
  boolean: ['type', 'description', 'default'],
  enum: ['type', 'description', 'options', 'default'],
  text: ['type', 'description', 'default'],
  object: ['type', 'description', 'default'],
  collection: ['type', 'description', 'cap', 'fields'],
};

const withoutKnown = (type: StateKeyType, properties: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(properties).filter(([name]) => !KNOWN[type].includes(name)));

const blankKey = (uid: string, type: StateKeyType, name = ''): KeyDraft => ({
  uid,
  name,
  type,
  description: '',
  default: '',
  min: '',
  max: '',
  options: '',
  cap: '',
  fields: '',
  rest: {},
});

function keyDraft(uid: string, name: string, def: StateKeyDef): KeyDraft {
  const key: KeyDraft = {
    ...blankKey(uid, def.type, name),
    description: def.description ?? '',
    rest: withoutKnown(def.type, def),
  };
  switch (def.type) {
    case 'number':
      return { ...key, default: numberText(def.default), min: numberText(def.min), max: numberText(def.max) };
    case 'boolean':
      return { ...key, default: def.default === undefined ? '' : String(def.default) };
    case 'enum':
      return { ...key, options: optionsText(def.options), default: def.default ?? '' };
    case 'text':
      return { ...key, default: def.default ?? '' };
    case 'object':
      return { ...key, default: objectText(def.default) };
    case 'collection':
      return { ...key, cap: numberText(def.cap), fields: fieldsText(def.fields) };
  }
}

export function toDraft(definition: StateDefinition): DefinitionDraft {
  return {
    name: definition.name,
    description: definition.description ?? '',
    keys: Object.entries(definition.keys).map(([name, def], index) => keyDraft(`k${index}`, name, def)),
  };
}

let created = 0;
/** A blank row for a number key (the most common). */
export const newKeyDraft = (): KeyDraft => blankKey(`n${++created}`, 'number');

/** Switches a key's type: what belonged to the old type is cleared, the name, description and unknown properties stay. */
export const changeKeyType = (key: KeyDraft, type: StateKeyType): KeyDraft => ({
  ...blankKey(key.uid, type, key.name),
  description: key.description,
  rest: withoutKnown(type, key.rest),
});

/** The value with object properties in a fixed order, so unknown nested properties compare by content. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([name, item]) => [name, canonical(item)]),
        )
      : value;

/** Equality key of a draft: rows are compared by content, never by their local uid or property order. */
const draftKey = (draft: DefinitionDraft): string =>
  JSON.stringify({
    name: draft.name,
    description: draft.description,
    keys: draft.keys.map(({ uid: _uid, rest, ...key }) => ({ ...key, rest: canonical(rest) })),
  });

/** True when the draft differs from what the definition holds. */
export const draftChanged = (draft: DefinitionDraft, definition: StateDefinition): boolean =>
  draftKey(draft) !== draftKey(toDraft(definition));

/** The draft as the server would store it, or undefined when it cannot be saved. */
function stored(draft: DefinitionDraft, definition: StateDefinition): DefinitionDraft | undefined {
  const { body } = compile(draft);
  // A body without a description clears it on the server.
  return body && toDraft({ ...definition, description: undefined, ...body } as StateDefinition);
}

/** What a fresh definitions list means for the open editor (see `classifyDraftChange`). */
export function classifyDefinitionChange(
  editor: { draft?: DefinitionDraft; definition?: StateDefinition; deleting?: boolean },
  fresh: readonly StateDefinition[],
): DiskChange<StateDefinition> {
  return classifyDraftChange({ ...editor, item: editor.definition }, fresh, { toDraft, stored, key: draftKey });
}
