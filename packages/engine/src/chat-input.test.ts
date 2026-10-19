import { describe, expect, it } from 'vitest';
import type { ChatMessage, Edge, Workflow } from '@st/shared';
import { executeWorkflow } from './executor.js';
import { chatInput } from './nodes/chat-input/index.js';
import { registry } from './registry.js';
import { snapshotOf } from './test-state.js';

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config: { ...registry.get(type)?.defaultConfig, ...config },
  position: { x: 0, y: 0 },
});
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const workflow = (nodes: Workflow['nodes'], edges: Edge[]): Workflow => ({
  id: 'w',
  name: 'Test',
  nodes,
  edges,
  createdAt: '',
  updatedAt: '',
});
const reply = (content: string): ChatMessage => ({
  id: `m-${content}`,
  role: 'assistant',
  content,
  createdAt: '',
  executionId: 't',
});
const options = { message: 'hi', sessionId: 's', history: [], secrets: { get: async () => undefined } };

describe('Chat Input', () => {
  it('has the message, history, replies and turn outputs, typed', () => {
    expect(chatInput.outputs.map((port) => `${port.name}:${port.dataType}`)).toEqual([
      'message:text',
      'history:messages',
      'replies:messages',
      'turn:number',
    ]);
  });

  it('outputs the replies of the workflows above it (an empty list by default) and the turn number', async () => {
    const wf = workflow(
      [node('input', 'chat-input'), node('replies', 'chat-output'), node('turn', 'chat-output', { order: 2 })],
      [edge('input', 'replies', 'replies', 'value'), edge('input', 'turn', 'turn', 'value')],
    );
    const state = snapshotOf([], { turn: 4 });
    const first = await executeWorkflow(wf, { ...options, state });
    expect(first.execution.nodes.input?.output).toMatchObject({ replies: [], turn: 4 });
    const above = [reply('one'), reply('two')];
    const second = await executeWorkflow(wf, { ...options, state, replies: above });
    expect(second.execution.nodes.input?.output).toMatchObject({ replies: above, turn: 4 });
    expect(second.replies.map(({ nodeId, content }) => [nodeId, content])).toEqual([
      ['replies', 'assistant: one\nassistant: two'],
      ['turn', '4'],
    ]);
  });

  it('hands out copies, so a node cannot change what the caller passed', async () => {
    const above = [reply('one')];
    const wf = workflow(
      [node('input', 'chat-input'), node('out', 'chat-output')],
      [edge('input', 'replies', 'out', 'value')],
    );
    const result = await executeWorkflow(wf, { ...options, replies: above });
    const output = result.execution.nodes.input?.output as { replies: ChatMessage[] };
    output.replies[0]!.content = 'changed';
    expect(above[0]!.content).toBe('one');
  });
});
