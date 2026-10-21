import { describe, expect, it } from 'vitest';
import type { NodePanelContext } from './panels/types.js';
import { nodeSummary } from './summaries.js';

const context = {
  presets: [{ id: 'p1', name: 'Narrator' }],
  characters: [],
  providers: [],
  collections: [{ id: 'c1', name: 'Rumors' }],
  stateDefinitions: [{ id: 'd1', name: 'scene', keys: {} }],
} as unknown as NodePanelContext;
const summary = (type: string, config: Record<string, unknown>, ctx: NodePanelContext | undefined = context) =>
  nodeSummary({ type }, config, ctx);

describe('nodeSummary', () => {
  it.each([
    ['an LLM names its model and preset', 'llm', { model: 'gpt-x', presetId: 'p1' }, 'gpt-x · Narrator'],
    ['an LLM with no preset says so', 'llm', { model: 'gpt-x', presetId: '' }, 'gpt-x · No preset'],
    [
      'an LLM whose preset is gone says so',
      'llm',
      { model: 'gpt-x', presetId: 'gone' },
      'gpt-x · Unknown preset (gone)',
    ],
    [
      'State Read names the key and what it reads',
      'state-read',
      { definitionId: 'd1', key: 'mood', read: 'meta' },
      'scene.mood · meta',
    ],
    ['State Read defaults to its value', 'state-read', { definitionId: 'd1', key: 'mood' }, 'scene.mood · value'],
    [
      'State Write names the key and operation',
      'state-write',
      { definitionId: 'd1', key: 'mood', op: 'add' },
      'scene.mood · add',
    ],
    [
      'a gone definition keeps its id visible',
      'state-write',
      { definitionId: 'zz', key: 'mood', op: 'set' },
      'Unknown definition (zz).mood · set',
    ],
    ['Thread names its key', 'thread', { definitionId: 'd1', key: 'chat' }, 'scene.chat'],
    ['Condition names its operator', 'condition', { operator: 'contains' }, 'contains'],
    ['Random names its mode', 'random', { mode: 'chance' }, 'chance'],
    ['Random without a mode is a number', 'random', {}, 'number'],
    [
      'HTTP Request names the method and URL',
      'http-request',
      { method: 'POST', url: 'https://x.test/a' },
      'POST · https://x.test/a',
    ],
    ['Recall lists its collections', 'recall', { collectionIds: ['c1', 'gone'] }, 'Rumors, Unknown collection (gone)'],
    ['Memory names its window', 'memory', { lastN: 6 }, 'Last 6 messages'],
    ['Memory can take everything', 'memory', { all: true }, 'All messages'],
  ])('%s', (_, type, config, expected) => {
    expect(summary(type, config)).toBe(expected);
  });

  it.each([
    ['a State node that is not set up', 'state-read', { definitionId: '', key: '' }],
    ['a Draw with no collection', 'draw', { collectionIds: [] }],
    ['a Condition with no operator', 'condition', {}],
    ['a type with no summary', 'chat-input', { anything: 1 }],
    ['an unknown type', 'from-the-future', {}],
  ])('has no line for %s', (_, type, config) => {
    expect(summary(type, config)).toBeUndefined();
  });

  it('reads any config without throwing, and works without a context', () => {
    expect(nodeSummary({ type: 'llm' }, { model: 5, presetId: { not: 'text' } })).toBe('No preset');
    expect(nodeSummary({ type: 'recall' }, { collectionIds: 'nope' })).toBeUndefined();
    expect(nodeSummary({ type: 'state-read' }, { definitionId: 'd1', key: 'k' })).toBe(
      'Unknown definition (d1).k · value',
    );
  });
});
