import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyStateSnapshot } from '@st/shared';
import { executeWorkflow } from './executor.js';
import { prepareWorkflow } from './prepare.js';
import { renderTemplate } from './template.js';
import { edge, graph, node } from './test-collections.js';
import {
  bump,
  key,
  payload,
  postOptions,
  register,
  resources,
  run,
  scene,
  standard,
  testType,
  unregister,
  withoutPost,
  write,
} from './test-post.js';
import type { EngineEvent, ExecutionContext } from './types.js';

afterEach(() => {
  unregister();
  vi.restoreAllMocks();
});

describe('the reply part', () => {
  it('skips the after-reply nodes, saying they run after the reply', async () => {
    const events: EngineEvent[] = [];
    const result = await executeWorkflow(standard(), {
      ...run,
      resources,
      state: emptyStateSnapshot([scene]),
      onEvent: (event) => events.push(event),
    });
    for (const id of ['after', 'postBump', 'postNote']) {
      expect(result.execution.nodes[id]?.status).toBe('skipped');
      // The log says why in plain words, so the reply's execution details don't read as if the work never ran.
      expect(result.execution.nodes[id]?.logs).toEqual(['Runs after the reply, in the after-reply run.']);
      expect(events).toContainEqual({ type: 'node:skipped', nodeId: id, detail: 'runs after the reply' });
    }
    expect(Object.keys(result.execution.nodes).sort()).toEqual([
      'after',
      'bump',
      'input',
      'output',
      'postBump',
      'postNote',
    ]);
  });

  it('gives the replies, writes and log of the same workflow without the after-reply nodes', async () => {
    const options = { ...run, resources, state: emptyStateSnapshot([scene]), seed: 'fixed' };
    const withPost = await executeWorkflow(standard(), options);
    const without = await executeWorkflow(withoutPost(), options);
    expect(withPost.replies).toEqual(without.replies);
    expect(withPost.writes).toEqual(without.writes);
    expect(withPost.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'bump', value: 4 }]);
    expect(withPost.execution.warnings).toEqual([]);
    expect(withPost.execution.nodes.output?.status).toBe('completed');
  });

  it('leaves reply logs without a `part` and with the seed it was given', async () => {
    const { execution } = await executeWorkflow(standard(), {
      ...run,
      resources,
      state: emptyStateSnapshot([scene]),
      seed: 'abc',
    });
    expect('part' in execution).toBe(false);
    expect(execution.seed).toBe('abc');
  });

  it('still says "not needed by any output" for a dead end, also one fed by After Reply', async () => {
    register(testType('pass-test'));
    const wf = standard();
    wf.nodes.push(node('dead1', 'pass-test'), node('dead2', 'pass-test'));
    wf.edges.push(edge('input', 'message', 'dead1', 'value'), edge('after', 'text', 'dead2', 'value'));
    const events: EngineEvent[] = [];
    const { execution } = await executeWorkflow(wf, {
      ...run,
      resources,
      state: emptyStateSnapshot([scene]),
      onEvent: (event) => events.push(event),
    });
    expect(execution.nodes.dead1?.logs).toBeUndefined();
    expect(events).toContainEqual({ type: 'node:skipped', nodeId: 'dead1', detail: 'not needed by any output' });
    expect(events).toContainEqual({ type: 'node:skipped', nodeId: 'dead2', detail: 'not needed by any output' });
    expect(events).toContainEqual({ type: 'node:skipped', nodeId: 'after', detail: 'runs after the reply' });
  });

  it('a workflow without after-reply sinks has no post sinks', async () => {
    const { prepared } = await prepareWorkflow(withoutPost(), resources);
    expect(prepared!.parts.postSinks).toEqual([]);
    expect([...prepared!.parts.post]).toEqual([]);
  });
});

describe('the post part', () => {
  it('runs only the nodes after-reply sinks need and logs only those', async () => {
    const events: EngineEvent[] = [];
    const result = await executeWorkflow(standard(), { ...postOptions, onEvent: (event) => events.push(event) });
    expect(Object.keys(result.execution.nodes).sort()).toEqual(['after', 'postBump', 'postNote']);
    expect(result.execution).toMatchObject({ part: 'post', status: 'completed' });
    expect(result.execution.nodes.after?.output).toEqual({ replies: payload.replies, text: 'Hello there', turn: 1 });
    expect(events.filter((event) => event.type === 'node:skipped')).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'execution:complete', detail: 'completed' });
  });

  it('has no replies and no "No Chat Output" warning', async () => {
    const result = await executeWorkflow(standard(), postOptions);
    expect(result.replies).toEqual([]);
    expect(result.execution.warnings).toEqual([]);
  });

  it('feeds After Reply’s outputs to the nodes after it', async () => {
    const result = await executeWorkflow(standard(), postOptions);
    expect(result.writes).toEqual([
      { op: 'set', target: key('tension'), nodeId: 'postBump', value: 4 },
      { op: 'set', target: key('note'), nodeId: 'postNote', value: 'Hello there' },
    ]);
  });

  it('gives every After Reply node the same payload, and an empty turn its empty one', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('a1', 'after-reply'),
        node('a2', 'after-reply'),
        bump('w1'),
        bump('w2'),
      ],
      [edge('input', 'message', 'output', 'value'), edge('a1', 'turn', 'w1', 'when'), edge('a2', 'turn', 'w2', 'when')],
    );
    const empty = { replies: [], text: '', turn: 3 };
    const result = await executeWorkflow(wf, { ...postOptions, afterReply: empty });
    expect(result.execution.nodes.a1?.output).toEqual(empty);
    expect(result.execution.nodes.a2?.output).toEqual(empty);
  });

  it('shows nodes the context of the turn it follows: message, turn, settings and the payload', async () => {
    const seen: Array<{
      trigger: ExecutionContext['trigger'];
      stateTurn: number;
      settings: unknown;
      rendered: string;
      replies: unknown;
    }> = [];
    register(
      testType('probe-test', {
        execute: async (ctx) => {
          seen.push({
            trigger: ctx.trigger,
            stateTurn: ctx.state.turn,
            settings: ctx.settings,
            rendered: renderTemplate('{{trigger.turn}}|{{trigger.message}}|{{settings.mood}}', ctx),
            replies: ctx.afterReply?.replies,
          });
          return { value: ctx.inputs.value };
        },
      }),
    );
    const wf = standard('probe-test');
    const state = { ...emptyStateSnapshot([scene]), turn: 7 };
    await executeWorkflow(wf, { ...postOptions, state, message: 'the question', settings: { mood: 'grim' } });
    expect(seen).toEqual([
      {
        trigger: { message: 'the question', sessionId: 'session', turn: 7 },
        stateTurn: 7,
        settings: { mood: 'grim' },
        rendered: '7|the question|grim',
        replies: payload.replies,
      },
    ]);
  });

  it('runs a node that both parts need in both runs', async () => {
    const shared = vi.fn(async (ctx: ExecutionContext) => ({ value: `${ctx.trigger.message}!` }));
    register(testType('shared-test', { execute: shared }));
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('shared', 'shared-test'),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        write('note', 'note', 'set'),
      ],
      [
        edge('input', 'message', 'shared', 'value'),
        edge('shared', 'value', 'output', 'value'),
        edge('shared', 'value', 'note', 'value'),
        edge('after', 'turn', 'note', 'when'),
      ],
    );
    const reply = await executeWorkflow(wf, { ...run, resources });
    expect(shared).toHaveBeenCalledTimes(1);
    expect(reply.replies.map((item) => item.content)).toEqual(['hello!']);
    const post = await executeWorkflow(wf, { ...postOptions, message: 'hello' });
    expect(shared).toHaveBeenCalledTimes(2);
    expect(post.writes).toEqual([{ op: 'set', target: key('note'), nodeId: 'note', value: 'hello!' }]);
    expect(Object.keys(post.execution.nodes).sort()).toEqual(['after', 'input', 'note', 'shared']);
  });

  it('runs a Chat Output that feeds an after-reply node but never writes its reply', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        write('note', 'note', 'set'),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('output', 'reply', 'note', 'value'),
        edge('after', 'turn', 'note', 'when'),
      ],
    );
    const reply = await executeWorkflow(wf, { ...run, resources });
    expect(reply.replies.map((item) => item.content)).toEqual(['hello']);
    const post = await executeWorkflow(wf, postOptions);
    expect(post.execution.nodes.output?.status).toBe('completed');
    expect(post.replies).toEqual([]);
    expect(post.writes).toEqual([{ op: 'set', target: key('note'), nodeId: 'note', value: 'hello' }]);
  });

  it('works from a prepared workflow shared with the reply part', async () => {
    const { prepared } = await prepareWorkflow(standard(), resources);
    const reply = await executeWorkflow(prepared!, { ...run, resources, state: emptyStateSnapshot([scene]) });
    const post = await executeWorkflow(prepared!, postOptions);
    expect(reply.execution.nodes.after?.status).toBe('skipped');
    expect(post.execution.nodes.after?.status).toBe('completed');
    expect(prepared!.parts.postSinks).toEqual(['postBump', 'postNote']);
  });

  it('does nothing when the workflow has no after-reply sinks', async () => {
    const result = await executeWorkflow(withoutPost(), postOptions);
    expect(result.execution).toMatchObject({ part: 'post', status: 'completed', nodes: {} });
    expect(result.writes).toEqual([]);
  });

  it('refuses to run without the payload', async () => {
    await expect(executeWorkflow(standard(), { ...postOptions, afterReply: undefined })).rejects.toThrow(
      'executeWorkflow: part "post" needs the afterReply payload',
    );
  });

  it('treats an omitted part as the reply part', async () => {
    const options = { ...run, resources, state: emptyStateSnapshot([scene]), seed: 's' };
    const implicit = await executeWorkflow(standard(), options);
    const explicit = await executeWorkflow(standard(), { ...options, part: 'reply' });
    expect(explicit.replies).toEqual(implicit.replies);
    expect(explicit.writes).toEqual(implicit.writes);
    expect(Object.entries(explicit.execution.nodes).map(([id, item]) => [id, item.status])).toEqual(
      Object.entries(implicit.execution.nodes).map(([id, item]) => [id, item.status]),
    );
  });
});
