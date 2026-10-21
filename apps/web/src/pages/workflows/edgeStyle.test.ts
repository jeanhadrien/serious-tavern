import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { NodeTypeDescriptor } from '@st/shared';
import type { PortDataType } from '@st/shared/ports';
import { styleEdges } from './edgeStyle.js';
import type { CanvasNode } from './model.js';

const descriptor = (inputs: PortDataType[], outputs: PortDataType[]): NodeTypeDescriptor => ({
  type: 't',
  label: 'T',
  description: '',
  category: 'X',
  dynamicPorts: false,
  inputs: inputs.map((dataType) => ({ name: 'in', label: 'In', dataType })),
  outputs: outputs.map((dataType) => ({ name: 'out', label: 'Out', dataType })),
  configSchema: {},
  defaultConfig: {},
});
const node = (id: string, inputs: PortDataType[], outputs: PortDataType[]): CanvasNode => ({
  id,
  type: 'workflow',
  position: { x: 0, y: 0 },
  data: { descriptor: descriptor(inputs, outputs), config: {}, name: id },
});
const edge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  sourceHandle: 'out',
  target,
  targetHandle: 'in',
});

const nodes = [
  node('text', [], ['text']),
  node('number', [], ['number']),
  node('sink', ['text'], []),
  node('bad', ['number'], []),
];
// text → sink fits, number → sink converts, text → bad is refused.
const edges = [edge('fits', 'text', 'sink'), edge('converts', 'number', 'sink'), edge('refused', 'text', 'bad')];
const style = (options: { focused?: string; issues?: string[] }) =>
  Object.fromEntries(
    styleEdges(edges, nodes, { focused: options.focused, issues: new Set(options.issues) }).map((item) => [
      item.id,
      item,
    ]),
  );

describe('styleEdges', () => {
  it('leaves a compatible edge plain, dashes a converting one and reds a refused one', () => {
    const drawn = style({});
    expect(drawn.fits).toMatchObject({ label: undefined, style: undefined });
    expect(drawn.converts).toMatchObject({ label: '→text', style: { strokeDasharray: '6 4' } });
    expect(drawn.refused).toMatchObject({ label: 'incompatible', style: { stroke: '#ef8186', strokeWidth: 2 } });
  });

  it('reds every edge the issues name, not only the first, without animating them', () => {
    const drawn = style({ issues: ['fits', 'converts'] });
    for (const id of ['fits', 'converts'])
      expect(drawn[id]).toMatchObject({ style: { stroke: '#ef8186', strokeWidth: 3 } });
    expect(drawn.fits?.animated).toBeUndefined();
    expect(drawn.refused?.style).toMatchObject({ strokeWidth: 2 });
  });

  it('animates the one edge a link asked to show', () => {
    const drawn = style({ focused: 'fits' });
    expect(drawn.fits).toMatchObject({ animated: true, style: { strokeWidth: 3 } });
    expect(drawn.converts?.animated).toBeUndefined();
  });
});
