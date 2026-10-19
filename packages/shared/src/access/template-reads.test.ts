import { describe, expect, it } from 'vitest';
import type { StateDefinition } from '../state/definition.js';
import type { Resource } from './resources.js';
import { cardReads, cardTemplates, keyAccess, templateReads } from './template-reads.js';

const scene: StateDefinition = {
  id: 'scene-id',
  name: 'scene',
  keys: { tension: { type: 'number' }, mood: { type: 'enum', options: ['calm'] }, log: { type: 'collection' } },
  createdAt: '',
  updatedAt: '',
};
const cast: StateDefinition = { ...scene, id: 'cast-id', name: 'cast', keys: { known: { type: 'collection' } } };
const definitions = [scene, cast];
const key = (definitionId: string, name: string): Resource => ({ kind: 'key', definitionId, key: name });
const messages: Resource = { kind: 'messages' };

describe('templateReads', () => {
  const table: [string, string, Resource[]][] = [
    ['plain text', 'hello {{input.x}} {{trigger.message}} {{settings.k}}', []],
    ['a key', '{{state.scene.tension}}', [key('scene-id', 'tension')]],
    [
      'a key inside a block',
      '{{#if (gt state.scene.tension 3)}}{{state.scene.mood}}{{/if}}',
      [key('scene-id', 'tension'), key('scene-id', 'mood')],
    ],
    ['the chat history', '{{history}} and {{history.[0].content}}', [messages]],
    [
      'a collection key reads the chat too: its items carry links',
      '{{state.scene.log}}',
      [key('scene-id', 'log'), messages],
    ],
    ['the same key twice', '{{state.scene.tension}}{{state.scene.tension}}', [key('scene-id', 'tension')]],
    ['a whole definition', '{{state.scene}}', [{ kind: 'definition', definitionId: 'scene-id' }, messages]],
    [
      'a whole definition as an each argument',
      '{{#each state.cast}}x{{/each}}',
      [{ kind: 'definition', definitionId: 'cast-id' }, messages],
    ],
    [
      'a collection through each and linked',
      '{{#each (linked state.cast.known)}}{{text}}{{/each}}',
      [key('cast-id', 'known'), messages],
    ],
    ['a bare state', '{{state}}', [{ kind: 'state' }, messages]],
    ['lookup on state', '{{lookup state "scene"}}', [{ kind: 'state' }, messages]],
    ['a block over state', '{{#with state}}{{scene.tension}}{{/with}}', [{ kind: 'state' }, messages]],
    ['a lookup that reaches into the root context', '{{lookup @root "state"}}', [{ kind: 'state' }, messages]],
    ['this at the top level', '{{#if input.x}}{{lookup this "history"}}{{/if}}', [{ kind: 'state' }, messages]],
    ['an unknown definition name renders empty and reads nothing', '{{state.nothing.x}}', []],
    ['an unknown key renders empty and reads nothing', '{{state.scene.nothing}}', []],
    [
      'a path relative to an item is not the root state',
      '{{#each history}}{{state.scene.tension}}{{/each}}',
      [messages],
    ],
    [
      'a parent path from inside a block is the root state',
      '{{#each input.items}}{{../state.scene.tension}}{{/each}}',
      [key('scene-id', 'tension')],
    ],
    ['a template that does not parse renders as written', '{{#if}}{{state.scene.tension', []],
  ];
  it.each(table)('%s', (_name, template, expected) => {
    expect(templateReads(template, definitions)).toEqual(expected);
  });

  it('reads all the state for every reference when the definitions are not known', () => {
    expect(templateReads('{{state.scene.tension}}')).toEqual([{ kind: 'state' }, messages]);
    expect(templateReads('{{history}}')).toEqual([messages]);
    expect(templateReads('hello')).toEqual([]);
  });

  it('reads every definition that has the name', () => {
    const twin: StateDefinition = { ...scene, id: 'twin-id' };
    expect(templateReads('{{state.scene.tension}}', [scene, twin])).toEqual([
      key('scene-id', 'tension'),
      key('twin-id', 'tension'),
    ]);
  });
});

describe('keyAccess', () => {
  it('adds the chat for a collection, and for a key it cannot look up', () => {
    expect(keyAccess('scene-id', 'tension', scene)).toEqual([key('scene-id', 'tension')]);
    expect(keyAccess('scene-id', 'log', scene)).toEqual([key('scene-id', 'log'), messages]);
    expect(keyAccess('scene-id', 'log')).toEqual([key('scene-id', 'log'), messages]);
  });
});

describe('cards', () => {
  const character = {
    name: 'Ann',
    description: 'Tension is {{state.scene.tension}}.',
    personality: 'calm',
    notes: '{{history}}',
  };
  it('lists the field texts macros can show', () => {
    expect(cardTemplates(character, 'character')).toEqual(['Ann', 'Tension is {{state.scene.tension}}.', 'calm']);
    expect(cardTemplates({ name: 'Bo', description: 'x', other: 5 }, 'persona')).toEqual(['Bo', 'x']);
    expect(cardTemplates(undefined, 'character')).toEqual([]);
  });

  it('reads what the macros in those fields read', () => {
    expect(cardReads(character, 'character', definitions)).toEqual([key('scene-id', 'tension')]);
    expect(cardReads({ name: '{{history}}' }, 'persona', definitions)).toEqual([messages]);
    expect(cardReads(undefined, 'persona', definitions)).toEqual([]);
  });
});
