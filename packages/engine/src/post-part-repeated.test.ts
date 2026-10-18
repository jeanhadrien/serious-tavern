import { afterEach, describe, expect, it } from 'vitest';
import { foldStoryState, oldestFirst } from '@st/shared';
import { executeWorkflow } from './executor.js';
import { edge, graph, node } from './test-collections.js';
import { bump, key, postOptions, register, resources, run, scene, testType, unregister, write } from './test-post.js';
import { newChat, playPost, playTurn } from './test-state.js';

afterEach(unregister);

const tensionOf = (chat: ReturnType<typeof newChat>) =>
  foldStoryState({ definitions: oldestFirst(chat.definitions), messages: chat.messages, state: chat.state })
    .definitions[0]!.keys.tension!.value;

/** A node that stores an item in its own implicit state, like Draw does. */
const implicit = () =>
  testType('implicit-test', {
    execute: async (ctx) => {
      ctx.writeState({ target: { kind: 'node', key: 'draws' }, op: 'add', item: { text: 'seen' } });
      return { value: 'drawn' };
    },
  });

describe('state writes of nodes both parts run', () => {
  // `bump` is a reply sink (it writes this turn) and also feeds `consumer`, which waits for After Reply.
  const wired = () =>
    graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        bump('bump'),
        node('after', 'after-reply'),
        write('consumer', 'gold', 'set'),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('bump', 'value', 'consumer', 'value'),
        edge('after', 'turn', 'consumer', 'when'),
      ],
    );

  it('are not repeated: a reply-part increment wired into after-reply work counts once per turn', async () => {
    const chat = newChat([scene]);
    const first = await playTurn(chat, wired(), 'e1');
    expect(first.writes).toEqual([{ op: 'set', target: key('tension'), nodeId: 'bump', value: 4 }]);
    const post = await playPost(chat, wired(), first);
    expect(post.execution.nodes.bump?.status).toBe('completed');
    // The increment ran again (it feeds `consumer`), but only the post-only State Write wrote.
    expect(post.writes.map((item) => item.nodeId)).toEqual(['consumer']);
    expect(tensionOf(chat)).toBe(4);
    await playPost(chat, wired(), await playTurn(chat, wired(), 'e2'));
    expect(tensionOf(chat)).toBe(5);
  });

  it('say so in the post log, naming the node', async () => {
    const chat = newChat([scene]);
    const post = await playPost(chat, wired(), await playTurn(chat, wired(), 'e1'));
    expect(post.execution.warnings).toEqual([
      '"State Write #1 (state-write)" also ran in the reply run, so its state writes were not repeated in this run.',
    ]);
  });

  it('keep writing in the reply run itself', async () => {
    const reply = await executeWorkflow(wired(), { ...run, resources, state: postOptions.state });
    expect(reply.writes.map((item) => item.nodeId)).toEqual(['bump']);
    expect(reply.execution.warnings).toEqual([]);
  });

  it('do not touch a post-only State Write fed by After Reply', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        bump('postBump'),
        write('postNote', 'note', 'set'),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('after', 'turn', 'postBump', 'when'),
        edge('after', 'text', 'postNote', 'value'),
      ],
    );
    const result = await executeWorkflow(wf, postOptions);
    expect(result.writes.map((item) => item.nodeId)).toEqual(['postBump', 'postNote']);
    expect(result.execution.warnings).toEqual([]);
  });

  it('also cover a node’s own implicit state (Draw’s kind of write)', async () => {
    register(implicit());
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('shared', 'implicit-test'),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        node('postOnly', 'implicit-test'),
        write('note', 'note', 'set'),
        write('postNote', 'note', 'set'),
      ],
      [
        edge('input', 'message', 'shared', 'value'),
        edge('shared', 'value', 'output', 'value'),
        edge('shared', 'value', 'note', 'value'),
        edge('after', 'turn', 'note', 'when'),
        edge('after', 'text', 'postOnly', 'value'),
        edge('postOnly', 'value', 'postNote', 'value'),
      ],
    );
    const reply = await executeWorkflow(wf, { ...run, resources, state: postOptions.state, executionId: 'r1' });
    expect(reply.writes.map((item) => [item.nodeId, item.target.kind])).toEqual([['shared', 'node']]);
    const post = await executeWorkflow(wf, { ...postOptions, executionId: 'p1' });
    // `shared` ran again but its draw is not stored twice; `postOnly` is exclusive to the post run and stores its own.
    expect(post.writes.map((item) => [item.nodeId, item.target.kind])).toEqual([
      ['postOnly', 'node'],
      ['note', 'definition'],
      ['postNote', 'definition'],
    ]);
    expect(post.execution.warnings).toEqual([
      '"implicit-test #1 (implicit-test)" also ran in the reply run, so its state writes were not repeated in this run.',
    ]);
  });

  it('are silent when the repeated node asked for no write', async () => {
    register(testType('plain-test'));
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('plain', 'plain-test'),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        write('note', 'note', 'set'),
      ],
      [
        edge('input', 'message', 'plain', 'value'),
        edge('plain', 'value', 'output', 'value'),
        edge('plain', 'value', 'note', 'value'),
        edge('after', 'turn', 'note', 'when'),
      ],
    );
    const post = await executeWorkflow(wf, postOptions);
    expect(post.writes.map((item) => item.nodeId)).toEqual(['note']);
    expect(post.execution.warnings).toEqual([]);
  });
});
