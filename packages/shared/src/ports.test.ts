import { describe, expect, it } from 'vitest';
import { dataTypeSchema, portSchema } from './index.js';
import { canConnect } from './ports.js';

describe('port compatibility', () => {
  it.each([
    ['text', 'text', true, undefined],
    ['any', 'number', true, undefined],
    ['object', 'any', true, undefined],
    ['messages', 'array', true, undefined],
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
    expect(dataTypeSchema.options).toHaveLength(7);
  });
});
