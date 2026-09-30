import { describe, expect, it } from 'vitest';
import type { ApiResponse } from '@st/shared';
import type { CanvasNode } from './model.js';
import { applyResolvedPorts, portRequests, portsEqual, resolvePortRequests } from './dynamicPorts.js';

const base: ApiResponse<'resolvePorts'> = {
  inputs: [{ name: 'input', label: 'Input', dataType: 'text' }],
  outputs: [{ name: 'output', label: 'Output', dataType: 'text' }],
};
function node(type = 'plugin', dynamicPorts = true): CanvasNode {
  return {
    id: type,
    type: 'workflow',
    position: { x: 12, y: 34 },
    selected: true,
    data: {
      descriptor: {
        type,
        label: type,
        description: '',
        category: '',
        dynamicPorts,
        ...base,
        configSchema: {},
        defaultConfig: {},
      },
      config: { mode: 'first' },
    },
  };
}

describe('dynamic ports', () => {
  it('resolves every advertised capability, not just LLMs, and leaves unknown/static nodes alone', () => {
    const unknown = node('unknown');
    unknown.data.unknown = true;
    expect(
      portRequests([node('llm'), node('character'), node(), node('static', false), unknown]).map(
        (request) => request.type,
      ),
    ).toEqual(['llm', 'character', 'plugin']);
  });

  it('compares both inputs and outputs, including their metadata and order', () => {
    expect(portsEqual(base, structuredClone(base))).toBe(true);
    expect(portsEqual(base, { ...base, inputs: [] })).toBe(false);
    expect(portsEqual(base, { ...base, outputs: [] })).toBe(false);
    expect(portsEqual(base, { ...base, outputs: [{ ...base.outputs[0]!, description: 'Changed' }] })).toBe(false);
    const inputs = [...base.inputs, { name: 'other', label: 'Other', dataType: 'number' as const }];
    expect(portsEqual({ ...base, inputs }, { ...base, inputs: [...inputs].reverse() })).toBe(false);
  });

  it('updates output-only changes without rebuilding position, selection, config or untouched nodes', () => {
    const current = node();
    const staticNode = node('static', false);
    const request = portRequests([current])[0]!;
    const result = applyResolvedPorts([current, staticNode], request, { ...base, outputs: [] });
    expect(result[0]?.data.descriptor.outputs).toEqual([]);
    expect(result[0]?.position).toBe(current.position);
    expect(result[0]?.selected).toBe(true);
    expect(result[0]?.data.config).toBe(current.data.config);
    expect(result[1]).toBe(staticNode);
    expect(applyResolvedPorts([current], request, base)[0]).toBe(current);
  });

  it('rejects results for changed configs, changed types, removed nodes and unknown placeholders', () => {
    const current = node();
    const request = portRequests([current])[0]!;
    const changed = { ...current, data: { ...current.data, config: { mode: 'new' } } };
    const unknown = { ...current, data: { ...current.data, unknown: true } };
    const changedType = {
      ...current,
      data: { ...current.data, descriptor: { ...current.data.descriptor, type: 'other' } },
    };
    for (const stale of [changed, unknown, changedType])
      expect(applyResolvedPorts([stale], request, { inputs: [], outputs: [] })[0]).toBe(stale);
    expect(applyResolvedPorts([], request, base)).toEqual([]);
  });

  it('ignores a slower cancelled batch, even if a newer canvas has the same node id and config', async () => {
    const requests = portRequests([node()]);
    let finishOld!: (ports: ApiResponse<'resolvePorts'>) => void;
    const oldResponse = new Promise<ApiResponse<'resolvePorts'>>((resolve) => {
      finishOld = resolve;
    });
    let oldActive = true;
    let nodes = [node()];
    const accept = (request: (typeof requests)[number], ports: ApiResponse<'resolvePorts'>) => {
      nodes = applyResolvedPorts(nodes, request, ports);
    };
    const oldBatch = resolvePortRequests(
      requests,
      () => oldResponse,
      accept,
      () => oldActive,
    );
    oldActive = false;
    await resolvePortRequests(
      requests,
      async () => ({ ...base, outputs: [] }),
      accept,
      () => true,
    );
    finishOld(base);
    await oldBatch;
    expect(nodes[0]?.data.descriptor.outputs).toEqual([]);
  });
});
