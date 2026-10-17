import { describe, expect, it, vi } from 'vitest';
import type { ApiResponse } from '@st/shared';
import type { CanvasNode } from './model.js';
import { checkConnection } from '../../connection.js';
import {
  applyResolvedPorts,
  createPortErrors,
  portRequests,
  portsEqual,
  resolvePortRequests,
  unsetSettings,
} from './dynamicPorts.js';

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
      name: `${type} #1 (${type})`,
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
    const result = applyResolvedPorts([current, staticNode], [], request, { ...base, outputs: [] });
    expect(result.nodes[0]?.data.descriptor.outputs).toEqual([]);
    expect(result.nodes[0]?.position).toBe(current.position);
    expect(result.nodes[0]?.selected).toBe(true);
    expect(result.nodes[0]?.data.config).toBe(current.data.config);
    expect(result.nodes[1]).toBe(staticNode);
    expect(applyResolvedPorts([current], [], request, base).nodes[0]).toBe(current);
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
      expect(applyResolvedPorts([stale], [], request, { inputs: [], outputs: [] }).nodes[0]).toBe(stale);
    expect(applyResolvedPorts([], [], request, base).nodes).toEqual([]);
  });

  it('prunes edges whose handle disappears when the resolved node keeps its config', () => {
    const nodes = [node(), node('target', false)];
    const edges = [{ id: 'edge', source: 'plugin', sourceHandle: 'output', target: 'target', targetHandle: 'input' }];
    const pruned = applyResolvedPorts(nodes, edges, portRequests(nodes)[0]!, { ...base, outputs: [] });
    expect(pruned.edges).toEqual([]);
    expect(checkConnection(edges[0]!, pruned.nodes).ok).toBe(false);
    const kept = applyResolvedPorts(nodes, edges, portRequests(nodes)[0]!, base);
    expect(kept.edges).toEqual(edges);
  });

  it('leaves edges untouched when a stale result is ignored', () => {
    const current = node();
    const changed = { ...current, data: { ...current.data, config: { mode: 'new' } } };
    const edges = [{ id: 'edge', source: 'plugin', sourceHandle: 'output', target: 'target', targetHandle: 'input' }];
    const result = applyResolvedPorts([changed], edges, portRequests([current])[0]!, { inputs: [], outputs: [] });
    expect(result.nodes[0]).toBe(changed);
    expect(result.edges).toBe(edges);
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
      nodes = applyResolvedPorts(nodes, [], request, ports).nodes;
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

// The config schema State Read and State Write send (their required ids are `minLength: 1` strings).
const stateSchema = {
  type: 'object',
  properties: {
    definitionId: { type: 'string', minLength: 1 },
    key: { type: 'string', minLength: 1 },
    read: { type: 'string', default: 'value', enum: ['value', 'meta'] },
  },
  required: ['definitionId', 'key', 'read'],
};

describe('unsetSettings', () => {
  it('names the required text settings that are blank, missing or only spaces', () => {
    expect(unsetSettings(stateSchema, { definitionId: '', key: '', read: 'value' })).toEqual(['definitionId', 'key']);
    expect(unsetSettings(stateSchema, {})).toEqual(['definitionId', 'key']);
    expect(unsetSettings(stateSchema, { definitionId: 'd', key: '  ' })).toEqual(['key']);
    expect(unsetSettings(stateSchema, { definitionId: 'd', key: 'tension' })).toEqual([]);
  });

  it('ignores settings with a default, other types and a schema without properties', () => {
    const schema = {
      properties: {
        provider: { type: 'string', minLength: 1, default: 'openrouter' },
        note: { type: 'string' },
        count: { type: 'number', minimum: 1 },
        flag: true,
      },
    };
    expect(unsetSettings(schema, {})).toEqual([]);
    expect(unsetSettings({}, {})).toEqual([]);
    expect(unsetSettings({ properties: 'x' }, {})).toEqual([]);
  });

  it('is what a canvas node asks of its port request', () => {
    const blank = node('state-read');
    blank.data.descriptor = { ...blank.data.descriptor, configSchema: stateSchema };
    blank.data.config = { definitionId: '', key: '', read: 'value' };
    expect(portRequests([blank])[0]?.unset).toEqual(['definitionId', 'key']);
    const picked = { ...blank, data: { ...blank.data, config: { definitionId: 'd', key: 'tension', read: 'value' } } };
    expect(portRequests([picked])[0]?.unset).toEqual([]);
  });
});

describe('port error toasts', () => {
  const setup = () => {
    let next = 0;
    const alerts = { error: vi.fn(() => `alert-${++next}`), dismiss: vi.fn() };
    return { alerts, errors: createPortErrors(alerts) };
  };

  it('shows a node’s error once, however often the same failure repeats', () => {
    const { alerts, errors } = setup();
    errors.failed('a', 'Select a state definition');
    errors.failed('a', 'Select a state definition');
    expect(alerts.error).toHaveBeenCalledTimes(1);
    // Another node's failure is its own toast.
    errors.failed('b', 'Select a state definition');
    expect(alerts.error).toHaveBeenCalledTimes(2);
  });

  it('replaces the toast when the failure changes and dismisses it when the node resolves', () => {
    const { alerts, errors } = setup();
    errors.failed('a', 'Select a state definition');
    errors.failed('a', 'Select a key');
    expect(alerts.dismiss).toHaveBeenCalledWith('alert-1');
    expect(alerts.error).toHaveBeenLastCalledWith('Select a key');
    errors.resolved('a');
    expect(alerts.dismiss).toHaveBeenLastCalledWith('alert-2');
    // Nothing left to dismiss, and a later failure shows again.
    errors.resolved('a');
    expect(alerts.dismiss).toHaveBeenCalledTimes(2);
    errors.failed('a', 'Select a key');
    expect(alerts.error).toHaveBeenCalledTimes(3);
  });

  it('shows nothing for a node that is still being set up, and takes back the toast it had', () => {
    const { alerts, errors } = setup();
    errors.failed('a', 'Select a state definition', false);
    expect(alerts.error).not.toHaveBeenCalled();
    // A real failure of a set-up node is shown; once the node is blank again the toast goes.
    errors.failed('a', 'State definition d not found');
    expect(alerts.error).toHaveBeenCalledTimes(1);
    errors.failed('a', 'Select a state definition', false);
    expect(alerts.dismiss).toHaveBeenCalledExactlyOnceWith('alert-1');
    expect(alerts.error).toHaveBeenCalledTimes(1);
  });

  it('drops the errors of nodes that left the canvas', () => {
    const { alerts, errors } = setup();
    errors.failed('a', 'x');
    errors.failed('b', 'y');
    errors.keepOnly(new Set(['b']));
    expect(alerts.dismiss).toHaveBeenCalledTimes(1);
    expect(alerts.dismiss).toHaveBeenCalledWith('alert-1');
    errors.keepOnly(new Set());
    expect(alerts.dismiss).toHaveBeenCalledTimes(2);
  });
});
