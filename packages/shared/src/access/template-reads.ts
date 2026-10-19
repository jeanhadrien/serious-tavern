import { macroRegistry } from '../macros.js';
import type { StateDefinition } from '../state/definition.js';
import { analyzeTemplate } from '../template-analysis.js';
import { simplify, type Resource } from './resources.js';

/**
 * What reading one key of a definition touches: the key, and for a collection also the chat, because an item's computed
 * `link` (status, positions) is judged against the chat's messages. With no `definition` (it could not be found) the key
 * might be a collection, so the chat counts.
 */
export function keyAccess(definitionId: string, key: string, definition?: Pick<StateDefinition, 'keys'>): Resource[] {
  const read: Resource = { kind: 'key', definitionId, key };
  return !definition || definition.keys[key]?.type === 'collection' ? [read, { kind: 'messages' }] : [read];
}

/** What reading a whole definition touches: all of it, and the chat when any of its keys is a collection. */
export function definitionAccess(definition: Pick<StateDefinition, 'id' | 'keys'>): Resource[] {
  const read: Resource = { kind: 'definition', definitionId: definition.id };
  return Object.values(definition.keys).some((def) => def.type === 'collection')
    ? [read, { kind: 'messages' }]
    : [read];
}

// Everything the story state holds, and the chat its links are judged against.
const wholeState = (): Resource[] => [{ kind: 'state' }, { kind: 'messages' }];

/**
 * What rendering a template reads of the chat's shared data, from the same walk that validates presets
 * (`analyzeTemplate`): `{{history}}` reads the chat; `{{state.<def>.<key>}}` a key, `{{state.<def>}}` (also as the
 * argument of `#each`, `#with` or `linked`) the definition, and a bare `state` (`lookup state …`, `#with state`) or
 * anything the walk cannot narrow all of the story state. A name that is not a definition renders empty and reads nothing.
 *
 * `definitions` is the listing the turn loaded, to map names to definitions; without it every `state` reference reads
 * all of the story state. Pure.
 */
export function templateReads(template: string, definitions?: readonly StateDefinition[]): Resource[] {
  const analysis = analyzeTemplate(template);
  const reads: Resource[] = analysis.dynamic ? [...wholeState(), { kind: 'messages' }] : [];
  for (const { name, root } of analysis.references) {
    // A path inside an `#each`/`#with` body is relative to the item, not to the render context.
    if (!root) continue;
    const [head, second, third] = name.split('.');
    if (head === 'history') reads.push({ kind: 'messages' });
    else if (head === 'state') {
      if (!definitions || second === undefined) reads.push(...wholeState());
      else
        for (const definition of definitions.filter((candidate) => candidate.name === second)) {
          if (third === undefined) reads.push(...definitionAccess(definition));
          else if (Object.hasOwn(definition.keys, third)) reads.push(...keyAccess(definition.id, third, definition));
        }
    }
  }
  return simplify(reads);
}

/**
 * The texts of a character's or persona's fields that macros can show (`{{character.description}}`, `{{user}}`): each is
 * itself a template, expanded wherever the card is rendered. Every such field is returned, whether or not a template
 * names it, because a run may render any of them.
 */
export function cardTemplates(card: object | undefined, source: 'character' | 'persona'): string[] {
  if (!card) return [];
  const fields = new Set(
    macroRegistry.flatMap((macro) => (macro.category === source && macro.field ? [macro.field] : [])),
  );
  return [...fields].flatMap((field) => {
    const value = (card as Record<string, unknown>)[field];
    return typeof value === 'string' ? [value] : [];
  });
}

/** What rendering the macros inside the fields of a character or persona reads (see `cardTemplates`). Pure. */
export function cardReads(
  card: object | undefined,
  source: 'character' | 'persona',
  definitions?: readonly StateDefinition[],
): Resource[] {
  return simplify(cardTemplates(card, source).flatMap((text) => templateReads(text, definitions)));
}
