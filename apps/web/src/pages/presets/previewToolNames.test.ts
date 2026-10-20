import { expect, it } from 'vitest';
import type { PromptMessage } from '@st/shared';
import { displayArguments, previewToolNames } from './previewToolNames.js';

const call = { id: 'c1', type: 'function' as const, function: { name: 'lookup', arguments: '{}' } };

it('names the tool a result answers only when the call is earlier', () => {
  const messages: PromptMessage[] = [
    { role: 'tool', content: 'early', tool_call_id: 'c1' },
    { role: 'assistant', content: '', tool_calls: [call] },
    { role: 'tool', content: 'late', tool_call_id: 'c1' },
    { role: 'user', content: 'hi' },
  ];
  expect(previewToolNames(messages)).toEqual([undefined, undefined, 'lookup', undefined]);
});

it('pretty-prints JSON objects and arrays and leaves anything else as it is', () => {
  expect(displayArguments('{"a":1}')).toBe('{\n  "a": 1\n}');
  expect(displayArguments('[1]')).toBe('[\n  1\n]');
  expect(displayArguments('{"a":')).toBe('{"a":');
  expect(displayArguments('42')).toBe('42');
  expect(displayArguments('')).toBe('');
});
