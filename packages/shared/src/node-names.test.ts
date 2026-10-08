import { expect, it } from 'vitest';
import { nodeDisplayName } from './node-names.js';

const nodes = [
  { id: 'input', type: 'chat-input' },
  { id: 'a', type: 'llm' },
  { id: 'b', type: 'llm' },
  { id: 'out', type: 'chat-output' },
];
const labelOf = (type: string) =>
  ({ 'chat-input': 'Chat Input', llm: 'LLM', 'chat-output': 'Chat Output' })[type] ?? type;

it.each([
  ['a', 'LLM #1 (llm)'],
  ['b', 'LLM #2 (llm)'],
  ['input', 'Chat Input #1 (chat-input)'],
  ['missing', 'missing'],
])('names %s as %s', (id, expected) => {
  expect(nodeDisplayName(nodes, labelOf, id)).toBe(expected);
});

it('numbers nodes per type in array order and falls back to the raw type as label', () => {
  expect(nodeDisplayName([...nodes, { id: 'c', type: 'unknown' }, { id: 'd', type: 'unknown' }], labelOf, 'd')).toBe(
    'unknown #2 (unknown)',
  );
});
