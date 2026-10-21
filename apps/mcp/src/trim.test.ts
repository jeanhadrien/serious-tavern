import { expect, it } from 'vitest';
import { MAX_DESCRIPTION_LENGTH, trimResponse } from './trim.js';

it('reduces each list item to id, name and description', () => {
  const items = [
    { id: 'a', name: 'First', description: 'About it', entries: [1, 2, 3], createdAt: 'x' },
    { id: 'b', name: 'Second' },
  ];
  expect(trimResponse('listPresets', items)).toEqual([
    { id: 'a', name: 'First', description: 'About it' },
    { id: 'b', name: 'Second' },
  ]);
});

it('falls back to type and label, as node types have no id or name', () => {
  const nodeTypes = [
    { type: 'llm', label: 'LLM', description: 'Calls a model', inputs: [{ name: 'x' }], configSchema: {} },
  ];
  expect(trimResponse('listNodeTypes', nodeTypes)).toEqual([
    { type: 'llm', label: 'LLM', description: 'Calls a model' },
  ]);
});

it('prefers id over type and name over label', () => {
  expect(trimResponse('listThings', [{ id: '1', type: 't', name: 'n', label: 'l' }])).toEqual([{ id: '1', name: 'n' }]);
});

it('cuts a long description', () => {
  const [item] = trimResponse('listCharacters', [{ id: 'a', name: 'A', description: 'x'.repeat(5000) }]) as {
    description: string;
  }[];
  expect(item!.description.length).toBe(MAX_DESCRIPTION_LENGTH + 1);
  expect(item!.description.endsWith('…')).toBe(true);
});

it('leaves an item with none of the kept fields as it is', () => {
  expect(trimResponse('listThings', [{ foo: 1 }, 'text', 3])).toEqual([{ foo: 1 }, 'text', 3]);
});

it('trims the lists inside an object answer and keeps its other fields', () => {
  const models = { models: [{ id: 'm', name: 'M', contextLength: 8000, pricing: {} }], fetchedAt: 'now' };
  expect(trimResponse('listProviderModels', models)).toEqual({ models: [{ id: 'm', name: 'M' }], fetchedAt: 'now' });
});

it('answers in full for anything that is not a list endpoint', () => {
  const workflow = { id: 'w', name: 'W', nodes: [{ id: 'n', type: 'llm' }] };
  expect(trimResponse('getWorkflow', workflow)).toBe(workflow);
  expect(trimResponse('validateWorkflow', { valid: true, errors: [{ message: 'x' }] })).toEqual({
    valid: true,
    errors: [{ message: 'x' }],
  });
});
