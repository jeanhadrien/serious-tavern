import { noAccess } from '@st/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChatMessage, Workflow } from '@st/shared';
import { type ExecutionFailure, executeWorkflow } from './executor.js';
import { registry } from './registry.js';
import type { ExecutionContext } from './types.js';

const register = (execute: (ctx: ExecutionContext) => Promise<Record<string, unknown>>) =>
  registry.set('log-test', {
    type: 'log-test',
    access: () => noAccess(),
    label: 'Log test',
    description: '',
    category: '',
    inputs: [],
    outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    configSchema: z.object({}),
    defaultConfig: {},
    execute,
  });
const at = { x: 0, y: 0 };
const workflow: Workflow = {
  id: 'w',
  name: 'W',
  createdAt: '',
  updatedAt: '',
  nodes: [
    { id: 'input', type: 'chat-input', config: {}, position: at },
    { id: 'log', type: 'log-test', config: {}, position: at },
    { id: 'output', type: 'chat-output', config: {}, position: at },
  ],
  edges: [{ id: 'e', source: 'log', sourceHandle: 'value', target: 'output', targetHandle: 'value' }],
};
const options = {
  message: 'hi',
  sessionId: 's',
  history: [] as ChatMessage[],
  secrets: { get: async () => undefined },
};

afterEach(() => {
  registry.delete('log-test');
});

describe('ctx.log', () => {
  it('appends lines to the node log in order', async () => {
    register(async (ctx) => {
      ctx.log('first');
      ctx.log('second');
      return { value: 'done' };
    });
    const { execution } = await executeWorkflow(workflow, options);
    expect(execution.nodes.log).toMatchObject({ status: 'completed', logs: ['first', 'second'] });
  });

  it('keeps the lines of a node that then fails', async () => {
    register(async (ctx) => {
      ctx.log('about to fail');
      throw new Error('broken');
    });
    const failure = await executeWorkflow(workflow, options).catch((error: unknown) => error);
    expect((failure as ExecutionFailure).execution.nodes.log).toMatchObject({
      status: 'error',
      error: 'broken',
      logs: ['about to fail'],
    });
  });

  it('leaves logs out when a node logs nothing', async () => {
    register(async () => ({ value: 'done' }));
    const { execution } = await executeWorkflow(workflow, options);
    expect(execution.nodes.log).not.toHaveProperty('logs');
  });

  it('ignores lines logged after the node settled', async () => {
    let late!: () => void;
    const logged = new Promise<void>((resolve) => {
      late = resolve;
    });
    register(async (ctx) => {
      setTimeout(() => {
        ctx.log('too late');
        late();
      }, 5);
      return { value: 'done' };
    });
    const { execution } = await executeWorkflow(workflow, options);
    await logged;
    expect(execution.nodes.log).not.toHaveProperty('logs');
  });
});
