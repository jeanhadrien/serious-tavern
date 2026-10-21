import { describe, expect, it } from 'vitest';
import { dataTypeSchema, portSchema } from './index.js';
import { canConnect, coerceValue, stringify } from './ports.js';

describe('port compatibility', () => {
  it.each([
    ['text', 'text', true, undefined],
    ['any', 'number', true, undefined],
    ['object', 'any', true, undefined],
    ['messages', 'array', true, undefined],
    ['character', 'character', true, undefined],
    ['character', 'any', true, undefined],
    ['any', 'character', true, undefined],
    ['character', 'object', true, undefined],
    ['character', 'text', false, undefined],
    ['object', 'character', false, undefined],
    ['text', 'character', false, undefined],
    ['number', 'text', true, 'to-text'],
    ['boolean', 'text', true, 'to-text'],
    ['object', 'text', true, 'to-text'],
    ['array', 'text', true, 'to-text'],
    ['messages', 'text', true, 'messages-to-text'],
    ['text', 'number', false, undefined],
    ['text', 'boolean', false, undefined],
    ['array', 'object', false, undefined],
    ['object', 'messages', false, undefined],
    ['boolean', 'number', false, undefined],
  ] as const)('%s → %s', (from, to, ok, coerce) => {
    const result = canConnect(from, to);
    expect(result.ok).toBe(ok);
    if (result.ok) expect(result.coerce).toBe(coerce);
    else expect(result.reason).toContain(`${from} to ${to}`);
  });
  it('defaults legacy port metadata to any', () => {
    expect(portSchema.parse({ name: 'value', label: 'Value' }).dataType).toBe('any');
    expect(dataTypeSchema.options).toHaveLength(8);
  });
});

describe('port value coercion', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    ['', ''],
    [0, '0'],
    [false, 'false'],
    ['text', 'text'],
  ])('preserves scalar conversion for %s', (value, expected) => {
    expect(stringify(value)).toBe(expected);
    expect(coerceValue(value, 'to-text')).toBe(expected);
  });

  it('uses the same role/content transcript for messages and ignores speaker names', () => {
    expect(
      coerceValue(
        [
          { role: 'user', content: 'Hello', name: 'User' },
          { role: 'assistant', content: 'Hi' },
        ],
        'messages-to-text',
      ),
    ).toBe('user: Hello\nassistant: Hi');
    expect(coerceValue([], 'messages-to-text')).toBe('');
    expect(coerceValue({ not: 'messages' }, 'messages-to-text')).toBe('{"not":"messages"}');
  });

  it('writes tool calls and tool results in the messages transcript', () => {
    const call = (id: string, name: string, args: string) => ({
      id,
      type: 'function' as const,
      function: { name, arguments: args },
    });
    const longArguments = `{"text":"${'a'.repeat(300)}"}`;
    expect(
      coerceValue(
        [
          { role: 'user', content: 'Go' },
          {
            role: 'assistant',
            content: 'Looking',
            tool_calls: [call('c1', 'read_state', '{"key":"a"}'), call('c2', 'x', '')],
          },
          { role: 'tool', content: 'value', tool_call_id: 'c1' },
          { role: 'tool', content: 'unknown call', tool_call_id: 'zzz' },
          { role: 'assistant', content: '', tool_calls: [call('c3', 'long', longArguments)] },
          { role: 'assistant', content: 'Done' },
        ],
        'messages-to-text',
      ),
    ).toBe(
      [
        'user: Go',
        'assistant: Looking',
        'assistant -> read_state({"key":"a"})',
        'assistant -> x()',
        'tool read_state: value',
        'tool: unknown call',
        'assistant: ',
        `assistant -> long(${longArguments})`,
        'assistant: Done',
      ].join('\n'),
    );
  });
});
