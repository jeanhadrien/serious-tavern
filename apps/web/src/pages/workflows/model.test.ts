import { describe, expect, it } from 'vitest';
import type { Workflow, NodeTypeDescriptor } from '@st/shared';
import { canvasToWorkflow, workflowToCanvas } from './model.js';

const workflow: Workflow = {
  id: 'workflow',
  name: 'Preserve unknown',
  createdAt: '',
  updatedAt: '',
  nodes: [
    { id: 'input', type: 'chat-input', config: {}, position: { x: 0, y: 0 } },
    {
      id: 'mystery',
      type: 'plugin-node',
      config: { nested: { keep: true }, title: 'unchanged' },
      position: { x: 200, y: 10 },
    },
    { id: 'output', type: 'chat-output', config: {}, position: { x: 400, y: 0 } },
  ],
  edges: [
    { id: 'one', source: 'input', sourceHandle: 'message', target: 'mystery', targetHandle: 'prompt' },
    { id: 'two', source: 'mystery', sourceHandle: 'answer', target: 'output', targetHandle: 'value' },
  ],
};
const knownTypes: NodeTypeDescriptor[] = ['chat-input', 'chat-output'].map((type) => ({
  type,
  label: type,
  description: '',
  category: 'Chat',
  dynamicPorts: false,
  inputs: type === 'chat-output' ? [{ name: 'value', label: 'Value', dataType: 'text' }] : [],
  outputs: type === 'chat-input' ? [{ name: 'message', label: 'Message', dataType: 'text' }] : [],
  configSchema: {},
  defaultConfig: {},
}));

describe('workflow canvas model', () => {
  it('keeps unknown nodes and their edges visible and unchanged through save conversion', () => {
    const model = workflowToCanvas(workflow, knownTypes);
    const unknown = model.nodes.find((node) => node.id === 'mystery')!;
    expect(model.unknownTypes).toEqual(['plugin-node']);
    expect(unknown.data).toMatchObject({
      unknown: true,
      config: workflow.nodes[1]!.config,
      descriptor: { type: 'plugin-node', inputs: [{ name: 'prompt' }], outputs: [{ name: 'answer' }] },
    });
    expect(canvasToWorkflow(workflow, model.nodes, model.edges)).toEqual(workflow);
  });

  it('keeps the chat settings declarations through save conversion', () => {
    const withSettings: Workflow = {
      ...workflow,
      settings: [{ key: 'mood', type: 'enum', options: ['calm'], future: true }],
    };
    const model = workflowToCanvas(withSettings, knownTypes);
    expect(canvasToWorkflow(withSettings, model.nodes, model.edges).settings).toEqual(withSettings.settings);
  });

  it('uses a late-loaded node type descriptor without changing its saved config or edges', () => {
    const descriptor: NodeTypeDescriptor = {
      type: 'plugin-node',
      label: 'Plugin node',
      description: 'Loaded later',
      category: 'Plugin',
      dynamicPorts: false,
      inputs: [{ name: 'prompt', label: 'Prompt', dataType: 'text' }],
      outputs: [{ name: 'answer', label: 'Answer', dataType: 'text' }],
      configSchema: {},
      defaultConfig: {},
    };
    const model = workflowToCanvas(workflow, [...knownTypes, descriptor]);
    expect(model.unknownTypes).toEqual([]);
    expect(model.nodes.find((node) => node.id === 'mystery')?.data).toMatchObject({
      descriptor,
      config: workflow.nodes[1]!.config,
    });
    expect(canvasToWorkflow(workflow, model.nodes, model.edges)).toEqual(workflow);
  });
});
