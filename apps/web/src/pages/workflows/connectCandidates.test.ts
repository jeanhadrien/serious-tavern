import { describe, expect, it } from 'vitest';
import type { NodeTypeDescriptor } from '@st/shared';
import type { PortDataType, PortDef } from '@st/shared/ports';
import { clampToBounds, connectCandidates, filterCandidates, type DragOrigin } from './connectCandidates.js';

const port = (name: string, dataType: PortDataType): PortDef => ({ name, label: name.toUpperCase(), dataType });
const type = (
  name: string,
  category: string,
  inputs: PortDef[],
  outputs: PortDef[],
  extra: Partial<NodeTypeDescriptor> = {},
): NodeTypeDescriptor => ({
  type: name,
  label: name,
  description: '',
  category,
  dynamicPorts: false,
  inputs,
  outputs,
  configSchema: {},
  defaultConfig: {},
  ...extra,
});
const names = (list: { descriptor: NodeTypeDescriptor }[]) => list.map((c) => c.descriptor.type);
const output = (dataType: PortDataType): DragOrigin => ({ side: 'source', port: port('out', dataType) });
const input = (dataType: PortDataType): DragOrigin => ({ side: 'target', port: port('in', dataType) });

const types = [
  type('chat-input', 'Chat', [], [port('message', 'text')]),
  type('chat-output', 'Chat', [port('value', 'text')], []),
  type('counter', 'Logic', [port('n', 'number')], [port('count', 'number')]),
  type('history', 'History', [], [port('messages', 'messages')]),
  type('llm', 'AI', [port('prompt', 'messages'), port('extra', 'text')], [port('text', 'text')]),
];

describe('connectCandidates from an output', () => {
  const table: [string, DragOrigin, string[]][] = [
    ['text goes to text inputs', output('text'), ['chat-output', 'llm']],
    ['number: exact and coerced inputs', output('number'), ['counter', 'chat-output', 'llm']],
    ['messages: pass-through and coerced', output('messages'), ['llm', 'chat-output']],
    ['object only reaches text inputs by coercion', output('object'), ['chat-output', 'llm']],
    ['character fits nothing here (not text, not object)', output('character'), []],
    ['any fits every input', output('any'), ['llm', 'chat-output', 'counter']],
  ];
  it.each(table)('%s', (_, origin, expected) => {
    expect(names(connectCandidates(origin, types, { hasChatInput: false })).sort()).toEqual([...expected].sort());
  });
});

describe('connectCandidates from an input', () => {
  const table: [string, DragOrigin, string[]][] = [
    ['text input: text outputs and coercible ones', input('text'), ['chat-input', 'counter', 'history', 'llm']],
    ['number input: only number outputs', input('number'), ['counter']],
    ['messages input: only messages outputs', input('messages'), ['history']],
  ];
  it.each(table)('%s', (_, origin, expected) => {
    expect(names(connectCandidates(origin, types, { hasChatInput: false })).sort()).toEqual([...expected].sort());
  });
});

describe('connectCandidates rules', () => {
  it('leaves out chat-input when the workflow already has one', () => {
    expect(names(connectCandidates(input('text'), types, { hasChatInput: true }))).not.toContain('chat-input');
    expect(names(connectCandidates(input('text'), types, { hasChatInput: false }))).toContain('chat-input');
  });
  it('prefers an exact port over one that coerces, whatever the order', () => {
    const mixed = type('mixed', 'X', [port('first', 'text'), port('second', 'number')], []);
    const [exact] = connectCandidates(output('number'), [mixed], { hasChatInput: false });
    expect(exact).toMatchObject({ port: { name: 'second' }, coerce: false });
    const [coerced] = connectCandidates(output('boolean'), [mixed], { hasChatInput: false });
    expect(coerced).toMatchObject({ port: { name: 'first' }, coerce: true });
  });
  it('takes the first exact port when several fit', () => {
    const twin = type('twin', 'X', [port('a', 'text'), port('b', 'text')], []);
    expect(connectCandidates(output('text'), [twin], { hasChatInput: false })[0]?.port.name).toBe('a');
  });
  it('judges dynamic-port types by their default ports', () => {
    const dynamic = type('dyn', 'X', [], [], { dynamicPorts: true });
    expect(connectCandidates(output('text'), [dynamic], { hasChatInput: false })).toEqual([]);
  });
  it('orders by category, then label', () => {
    const list = [
      type('b2', 'B', [port('v', 'text')], [], { label: 'Zed' }),
      type('b1', 'B', [port('v', 'text')], [], { label: 'Alpha' }),
      type('a1', 'A', [port('v', 'text')], [], { label: 'Mid' }),
    ];
    expect(names(connectCandidates(output('text'), list, { hasChatInput: false }))).toEqual(['a1', 'b1', 'b2']);
  });
});

describe('filterCandidates', () => {
  const all = connectCandidates(output('text'), types, { hasChatInput: false });
  it('keeps everything for a blank filter', () => {
    expect(filterCandidates(all, '  ')).toBe(all);
  });
  it('matches label, category and port words, ignoring case', () => {
    expect(names(filterCandidates(all, 'OUTPUT'))).toEqual(['chat-output']);
    expect(names(filterCandidates(all, 'ai'))).toEqual(['llm']);
    expect(names(filterCandidates(all, 'chat value'))).toEqual(['chat-output']);
    expect(filterCandidates(all, 'nothing like this')).toEqual([]);
  });
});

describe('clampToBounds', () => {
  const bounds = { width: 500, height: 400 };
  const size = { width: 200, height: 100 };
  it.each([
    [
      { x: 50, y: 60 },
      { x: 50, y: 60 },
    ],
    [
      { x: 450, y: 390 },
      { x: 300, y: 300 },
    ],
    [
      { x: -5, y: -5 },
      { x: 0, y: 0 },
    ],
  ])('%o', (at, expected) => {
    expect(clampToBounds(at, bounds, size)).toEqual(expected);
  });
  it('pins to the corner when the canvas is smaller than the picker', () => {
    expect(clampToBounds({ x: 30, y: 30 }, { width: 100, height: 50 }, size)).toEqual({ x: 0, y: 0 });
  });
});
