import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionFailure, executeWorkflow } from './executor.js';
import { postRunSeed } from './parts.js';
import { createRandom } from './seeded-random.js';
import { edge, graph, node } from './test-collections.js';
import {
  bump,
  key,
  postOptions,
  register,
  resources,
  run,
  scene,
  standard,
  testType,
  unregister,
  write,
} from './test-post.js';
import { SCENE_ID, newChat, playPost, playTurn } from './test-state.js';

afterEach(unregister);

describe('writes of the post part', () => {
  it('are minted under the post run’s own execution id', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        write('postAdd', 'injected', 'add'),
      ],
      [edge('input', 'message', 'output', 'value'), edge('after', 'text', 'postAdd', 'value')],
    );
    const result = await executeWorkflow(wf, { ...postOptions, executionId: 'post-1' });
    expect(result.writes).toEqual([
      { op: 'add', target: key('injected'), nodeId: 'postAdd', item: { id: 'post-1:postAdd:1', text: 'Hello there' } },
    ]);
  });

  it('resolve an increment against the state the post run started from: the reply’s own write included', async () => {
    const chat = newChat([scene]);
    const wf = standard();
    const first = await playTurn(chat, wf, 'e1');
    expect(first.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'bump', value: 4 }]);
    const post = await playPost(chat, wf, first);
    expect(post.writes[0]).toEqual({ op: 'set', target: key('tension'), nodeId: 'postBump', value: 5 });
    expect(post.execution.id).toBe('e1-post');
    const second = await playTurn(chat, wf, 'e2');
    expect(second.replies.map((item) => item.content)).toEqual(['n=5 turn=2']);
    const postTwo = await playPost(chat, wf, second);
    expect(postTwo.writes[0]).toMatchObject({ nodeId: 'postBump', value: 7 });
    expect(postTwo.execution.nodes.after?.output).toMatchObject({ turn: 2, text: 'n=5 turn=2' });
  });

  it('read the turn they follow: a key the reply wrote has turnsSinceWrite 0 and turn equals trigger.turn', async () => {
    const seen: Array<{ since: number | undefined; turn: number; trigger: number | undefined }> = [];
    register(
      testType('probe-test', {
        execute: async (ctx) => {
          seen.push({
            since: ctx.state.read(SCENE_ID, 'tension')?.meta.turnsSinceWrite,
            turn: ctx.state.turn,
            trigger: ctx.trigger.turn,
          });
          return { value: ctx.inputs.value };
        },
      }),
    );
    const wf = standard('probe-test');
    const chat = newChat([scene]);
    await playPost(chat, wf, await playTurn(chat, wf, 'e1'));
    await playPost(chat, wf, await playTurn(chat, wf, 'e2'));
    expect(seen).toEqual([
      { since: 0, turn: 1, trigger: 1 },
      { since: 0, turn: 2, trigger: 2 },
    ]);
  });

  it('keep the writes of the nodes that completed when a later node fails', async () => {
    register(
      testType('fail-test', {
        execute: async () => {
          throw new Error('boom');
        },
      }),
      testType('pass-test'),
    );
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        bump('postBump'),
        node('gate', 'pass-test'),
        node('fail', 'fail-test'),
        write('postNote', 'note', 'set'),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('after', 'turn', 'postBump', 'when'),
        edge('after', 'text', 'gate', 'value'),
        edge('gate', 'value', 'fail', 'value'),
        edge('fail', 'value', 'postNote', 'value'),
      ],
    );
    const error = await executeWorkflow(wf, postOptions).catch((cause) => cause);
    expect(error).toBeInstanceOf(ExecutionFailure);
    expect(error).toMatchObject({ nodeId: 'fail', nodeType: 'fail-test', replies: [] });
    expect(error.message).toContain('boom');
    expect(error.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'postBump', value: 4 }]);
    expect(error.execution).toMatchObject({ status: 'error', part: 'post' });
    expect(error.execution.nodes.fail).toMatchObject({ status: 'error', error: 'boom' });
    expect(error.execution.nodes.postNote).toBeUndefined();
  });

  it('keep the completed writes and cancel the running nodes when the run is aborted', async () => {
    const started: Array<() => void> = [];
    const entered = [0, 1].map(() => new Promise<void>((resolve) => started.push(resolve)));
    let next = 0;
    register(
      testType('slow-test', {
        execute: (ctx) => {
          started[next++]!();
          return new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason)));
        },
      }),
      testType('sink-test', { sink: true, outputs: [] }),
    );
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        bump('postBump'),
        node('slowA', 'slow-test'),
        node('slowB', 'slow-test'),
        node('sinkA', 'sink-test'),
        node('sinkB', 'sink-test'),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('after', 'turn', 'postBump', 'when'),
        edge('after', 'text', 'slowA', 'value'),
        edge('after', 'text', 'slowB', 'value'),
        edge('slowA', 'value', 'sinkA', 'value'),
        edge('slowB', 'value', 'sinkB', 'value'),
      ],
    );
    const controller = new AbortController();
    let bumped!: () => void;
    const bumpDone = new Promise<void>((resolve) => (bumped = resolve));
    const outcome = executeWorkflow(wf, {
      ...postOptions,
      signal: controller.signal,
      onEvent: (event) => event.type === 'node:complete' && event.nodeId === 'postBump' && bumped(),
    }).catch((cause) => cause);
    await Promise.all([...entered, bumpDone]);
    controller.abort(new Error('stopped by the user'));
    const error = await outcome;
    expect(error).toBeInstanceOf(ExecutionFailure);
    expect(error.execution).toMatchObject({ status: 'error', part: 'post' });
    expect(error.execution.nodes.slowA?.status).toBe('cancelled');
    expect(error.execution.nodes.slowB?.status).toBe('cancelled');
    expect(error.execution.nodes.postBump?.status).toBe('completed');
    expect(error.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'postBump', value: 4 }]);
  });
});

describe('the seed of the post part', () => {
  it('is derived from the turn seed by postRunSeed, pinned', () => {
    expect(postRunSeed('abc')).toBe('abc:post');
    expect(postRunSeed('')).toBe(':post');
  });

  it('draws a different sequence from the reply run’s for the same node, as createRandom(<seed>:post:<node>)', async () => {
    const draws: number[] = [];
    register(
      testType('roll-test', {
        execute: async (ctx) => {
          const drawn = ctx.random();
          draws.push(drawn);
          return { value: String(drawn) };
        },
      }),
    );
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('roll', 'roll-test'),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        write('note', 'note', 'set'),
      ],
      [
        edge('roll', 'value', 'output', 'value'),
        edge('roll', 'value', 'note', 'value'),
        edge('after', 'turn', 'note', 'when'),
      ],
    );
    const reply = await executeWorkflow(wf, { ...run, resources, seed: 'abc' });
    const post = await executeWorkflow(wf, { ...postOptions, seed: postRunSeed('abc') });
    expect(reply.execution.seed).toBe('abc');
    expect(post.execution.seed).toBe('abc:post');
    expect(draws).toEqual([createRandom('abc:roll')(), createRandom('abc:post:roll')()]);
    expect(draws[0]).not.toBe(draws[1]);
  });
});
