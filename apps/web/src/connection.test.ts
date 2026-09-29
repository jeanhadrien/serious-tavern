import { describe, expect, it } from 'vitest';
import { checkConnection } from './connection.js';
import type { NodeTypeDescriptor } from '@st/shared';

function descriptor(type: string, output: 'text' | 'messages', input: 'number' | 'text'): NodeTypeDescriptor {
  return {
    type, label: type, description: '', category: '', configSchema: {}, defaultConfig: {},
    inputs: [{ name: 'in', label: 'In', dataType: input }],
    outputs: [{ name: 'out', label: 'Out', dataType: output }]
  };
}
const nodes = [
  { id: 'a', data: { descriptor: descriptor('source', 'text', 'number') } },
  { id: 'b', data: { descriptor: descriptor('target', 'messages', 'number') } }
];
describe('editor connection checks', () => {
  it('prevents text-to-number connections', () => {
    expect(checkConnection({ source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'in' }, nodes))
      .toMatchObject({ ok: false, reason: expect.stringContaining('text to number') });
  });
  it('allows safe messages-to-text conversion', () => {
    expect(checkConnection({ source: 'b', sourceHandle: 'out', target: 'a', targetHandle: 'in' }, [
      nodes[1]!, { id: 'a', data: { descriptor: descriptor('text-input', 'text', 'text') } }
    ])).toEqual({ ok: true, coerce: 'messages-to-text' });
  });
});
