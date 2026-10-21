import { describe, expect, it } from 'vitest';
import type { ExecutionLog, NodeTypeDescriptor } from '@st/shared';
import type { PortDataType } from '@st/shared/ports';
import { lastRunIO, lastRunIsStale, previewValue } from './lastRunIO.js';
import type { CanvasNode } from './model.js';

const descriptor = (inputs: [string, PortDataType][], outputs: [string, PortDataType][]): NodeTypeDescriptor => ({
  type: 't',
  label: 'T',
  description: '',
  category: 'X',
  dynamicPorts: false,
  inputs: inputs.map(([name, dataType]) => ({ name, label: name.toUpperCase(), dataType })),
  outputs: outputs.map(([name, dataType]) => ({ name, label: name, dataType })),
  configSchema: {},
  defaultConfig: {},
});
const node = (id: string, inputs: [string, PortDataType][], outputs: [string, PortDataType][]): CanvasNode => ({
  id,
  type: 'workflow',
  position: { x: 0, y: 0 },
  data: { descriptor: descriptor(inputs, outputs), config: {}, name: id },
});
const nodes = [
  node(
    'source',
    [],
    [
      ['n', 'number'],
      ['t', 'text'],
      ['m', 'messages'],
    ],
  ),
  node('gone', [], [['t', 'text']]),
  node(
    'sink',
    [
      ['text', 'text'],
      ['raw', 'number'],
      ['unwired', 'text'],
    ],
    [['out', 'text']],
  ),
];
const edge = (source: string, sourceHandle: string, targetHandle: string) => ({
  source,
  sourceHandle,
  target: 'sink',
  targetHandle,
});
const log = (over: Partial<ExecutionLog['nodes']> = {}): ExecutionLog => ({
  id: 'run',
  workflowId: 'w',
  sessionId: 's',
  status: 'completed',
  startedAt: '',
  warnings: [],
  nodes: {
    source: { status: 'completed', output: { n: 5, t: 'hi', m: [{ role: 'user', content: 'yo' }] } },
    sink: { status: 'completed', output: { out: 'done' } },
    ...over,
  },
});

describe('lastRunIO', () => {
  it('reads the output from the log and rebuilds the inputs from the sources, converted as the executor does', () => {
    const io = lastRunIO(log(), 'sink', [edge('source', 'n', 'text'), edge('source', 'n', 'raw')], nodes);
    expect(io).toMatchObject({
      status: 'completed',
      output: { out: 'done' },
      inputs: [
        { port: 'text', arrived: true, value: '5' },
        { port: 'raw', arrived: true, value: 5 },
      ],
    });
  });

  it('converts a message list to its transcript', () => {
    expect(lastRunIO(log(), 'sink', [edge('source', 'm', 'text')], nodes)?.inputs).toEqual([
      { port: 'text', label: 'TEXT', arrived: true, value: 'user: yo' },
    ]);
  });

  it('lists only connected inputs, and says when nothing arrived', () => {
    const io = lastRunIO(
      log({ gone: { status: 'skipped' } }),
      'sink',
      [edge('gone', 't', 'text'), edge('source', 'missing', 'raw')],
      nodes,
    );
    expect(io?.inputs).toEqual([
      { port: 'text', label: 'TEXT', arrived: false },
      { port: 'raw', label: 'RAW', arrived: false },
    ]);
  });

  it('carries the skip reason and the error of the node', () => {
    const skipped = log({ sink: { status: 'skipped', skip: { reason: 'source-skipped', by: 'gone' } } });
    expect(lastRunIO(skipped, 'sink', [], nodes)).toMatchObject({ status: 'skipped', skip: { by: 'gone' } });
    const failed = log({ sink: { status: 'error', error: 'boom' } });
    expect(lastRunIO(failed, 'sink', [], nodes)).toMatchObject({ status: 'error', error: 'boom' });
    expect(lastRunIO(failed, 'sink', [], nodes)).not.toHaveProperty('output');
  });

  it('is undefined for a node the run never reached or the draft no longer has', () => {
    expect(lastRunIO(log(), 'gone', [], nodes)).toBeUndefined();
    expect(lastRunIO(log(), 'nope', [], nodes)).toBeUndefined();
  });
});

describe('previewValue', () => {
  it('shows text as it is and anything else as pretty JSON', () => {
    expect(previewValue('plain')).toEqual({ text: 'plain', truncated: false });
    expect(previewValue({ a: 1 })).toEqual({ text: '{\n  "a": 1\n}', truncated: false });
  });
  it('cuts long values and says so', () => {
    expect(previewValue('x'.repeat(10), 4)).toEqual({ text: 'xxxx…', truncated: true });
  });
});

describe('lastRunIsStale', () => {
  it.each([
    ['same version, clean draft', { workflowUpdatedAt: 'v1' }, false, 'v1', false],
    ['a dirty draft', { workflowUpdatedAt: 'v1' }, true, 'v1', true],
    ['saved since the run', { workflowUpdatedAt: 'v1' }, false, 'v2', true],
    ['an older log with no stamp', {}, false, 'v1', true],
  ])('%s', (_, stamp, dirty, updatedAt, expected) => {
    expect(lastRunIsStale(stamp, dirty, updatedAt)).toBe(expected);
  });
});
