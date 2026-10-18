import { afterEach, describe, expect, it } from 'vitest';
import { foldStoryState, oldestFirst, type ChatMessage } from '@st/shared';
import { edge, graph, node } from './test-collections.js';
import { MEMORY_ID, idRange, memoryDefinition, messagesOf, withEdit } from './test-links.js';
import { register, testType, unregister } from './test-post.js';
import { deleteReplies, newChat, playPost, playTurn } from './test-state.js';

afterEach(unregister);

// "Summaries, wired" (STATE-DESIGN-AMENDMENT-1): After Reply -> Next Chunk -> LLM -> State Write add with the link,
// played turn by turn the way the server does (fold, snapshot with links, run, store), with a fake LLM.
const wired = () =>
  graph(
    [
      node('input', 'chat-input'),
      node('output', 'chat-output', {
        template: 'status: {{#each state.memory.summaries}}{{this.link.status}}{{/each}}',
      }),
      node('after', 'after-reply'),
      node('chunk', 'next-chunk', { definitionId: MEMORY_ID, key: 'summaries', chunkSize: 4, rawWindow: 2 }),
      node('llm', 'fake-llm'),
      node('save', 'state-write', { definitionId: MEMORY_ID, key: 'summaries', op: 'add' }),
    ],
    [
      edge('input', 'message', 'output', 'value'),
      edge('after', 'turn', 'chunk', 'after'),
      edge('chunk', 'text', 'llm', 'value'),
      edge('llm', 'value', 'save', 'value'),
      edge('chunk', 'link', 'save', 'messages'),
    ],
  );

const useFakeLlm = () =>
  register(
    testType('fake-llm', {
      execute: async (ctx) => ({ value: `Summary: ${String(ctx.inputs.value).split('\n')[0]}` }),
    }),
  );

type Story = ReturnType<typeof foldStoryState>;
const summariesOf = (chat: ReturnType<typeof newChat>): Story['definitions'][number]['keys'][string] =>
  foldStoryState({ definitions: oldestFirst(chat.definitions), messages: chat.messages, state: chat.state })
    .definitions[0]!.keys.summaries!;
const items = (chat: ReturnType<typeof newChat>) =>
  summariesOf(chat).value as { id: string; text: string; messages: { ids: string[]; fingerprint: string } }[];

async function turn(chat: ReturnType<typeof newChat>, id: string, history: ChatMessage[]) {
  const reply = await playTurn(chat, wired(), id, 'go', history);
  const post = await playPost(chat, wired(), reply, 'go', history);
  return { reply, post };
}

describe('summaries as story state, wired', () => {
  it('does nothing while the chat is short: Next Chunk outputs nothing and the rest is skipped', async () => {
    useFakeLlm();
    const chat = newChat([memoryDefinition]);
    const { post } = await turn(chat, 'e1', messagesOf(4));
    expect(post.writes).toEqual([]);
    expect(post.execution.nodes.chunk).toMatchObject({ status: 'completed' });
    expect(post.execution.nodes.chunk?.logs?.[0]).toContain('Nothing to link yet');
    expect(post.execution.nodes.llm?.status).toBe('skipped');
    expect(post.execution.nodes.save?.status).toBe('skipped');
  });

  it('writes a summary linked to the chunk once the chat is long enough, and stays quiet after it', async () => {
    useFakeLlm();
    const chat = newChat([memoryDefinition]);
    const { post } = await turn(chat, 'e1', messagesOf(8));
    expect(post.writes).toHaveLength(1);
    const [stored] = items(chat);
    expect(stored).toMatchObject({ text: 'Summary: user: text 1', messages: { ids: idRange(1, 4) } });
    expect(stored!.messages.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(stored!.id).toBe('e1-post:save:1');
    // Six eligible messages, four covered: the next chunk needs four, so nothing happens yet.
    const next = await turn(chat, 'e2', messagesOf(8));
    expect(next.post.writes).toEqual([]);
    expect(items(chat)).toHaveLength(1);
    // Later, with more messages, the next chunk follows.
    const later = await turn(chat, 'e3', messagesOf(10));
    expect(later.post.writes).toHaveLength(1);
    expect(items(chat).map((item) => item.messages.ids)).toEqual([idRange(5, 8), idRange(1, 4)]);
  });

  it('lets the next turn read the summary with its computed link status in a template', async () => {
    useFakeLlm();
    const chat = newChat([memoryDefinition]);
    const history = messagesOf(8);
    await turn(chat, 'e1', history);
    const status = async (messages: ChatMessage[]) =>
      (await playTurn(chat, wired(), 'e2', 'go', messages)).replies.map((reply) => reply.content);
    expect(await status(history)).toEqual(['status: intact']);
    expect(await status(withEdit(history, 'm2', 'edited'))).toEqual(['status: changed']);
    expect(await status(withEdit(history, 'm2'))).toEqual(['status: partial']);
    expect(await status(history.slice(4))).toEqual(['status: gone']);
  });

  it('redoes a chunk after an edit, and the new item replaces the broken one without a remove', async () => {
    useFakeLlm();
    const chat = newChat([memoryDefinition]);
    const history = messagesOf(8);
    await turn(chat, 'e1', history);
    const edited = withEdit(history, 'm2', 'edited');
    const redo = await turn(chat, 'e2', edited);
    expect(redo.post.writes).toHaveLength(1);
    expect(items(chat).map((item) => item.id)).toEqual(['e2-post:save:1', 'e1-post:save:1']);
    // The old item is still stored (broken), but replaced: the next turn has nothing to do.
    const quiet = await turn(chat, 'e3', edited);
    expect(quiet.post.writes).toEqual([]);
    // Revert the edit: the old summary is intact again, the replacement is not, and nothing needs redoing.
    const reverted = await turn(chat, 'e4', history);
    expect(reverted.post.writes).toEqual([]);
  });

  it('forgets the summary with the turn that wrote it, and the next turn summarizes the chunk again', async () => {
    useFakeLlm();
    const chat = newChat([memoryDefinition]);
    const history = messagesOf(8);
    await turn(chat, 'e1', history);
    expect(items(chat)).toHaveLength(1);
    deleteReplies(chat, 'e1');
    expect(items(chat)).toHaveLength(0);
    const again = await turn(chat, 'e2', history);
    expect(again.post.writes).toHaveLength(1);
    expect(items(chat).map((item) => item.messages.ids)).toEqual([idRange(1, 4)]);
  });

  it('un-does a replacement with its turn: the broken item is redone again', async () => {
    useFakeLlm();
    const chat = newChat([memoryDefinition]);
    const history = messagesOf(8);
    await turn(chat, 'e1', history);
    const edited = withEdit(history, 'm2', 'edited');
    await turn(chat, 'e2', edited);
    deleteReplies(chat, 'e2');
    const redo = await turn(chat, 'e3', edited);
    expect(redo.post.writes).toHaveLength(1);
    expect(redo.post.execution.nodes.chunk?.logs?.[0]).toContain('no longer matches the chat');
  });
});

describe('a linked write of a node both parts run', () => {
  it('is stored once, in the reply part: the post run does not repeat it', async () => {
    register(
      testType('link-source', { execute: async () => ({ value: { ids: ['m1', 'm2'] } }) }),
      testType('note-source', { execute: async () => ({ value: 'a fact' }) }),
    );
    // `fact` is a reply sink (it stores this turn) and also feeds `consumer`, which waits for After Reply.
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('src', 'link-source'),
        node('text', 'note-source'),
        node('fact', 'state-write', { definitionId: MEMORY_ID, key: 'facts', op: 'add' }),
        node('after', 'after-reply'),
        node('consumer', 'state-write', { definitionId: MEMORY_ID, key: 'note', op: 'set' }),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('text', 'value', 'fact', 'value'),
        edge('src', 'value', 'fact', 'messages'),
        edge('fact', 'value', 'consumer', 'value'),
        edge('after', 'turn', 'consumer', 'when'),
      ],
    );
    const chat = newChat([memoryDefinition]);
    const history = messagesOf(4);
    const reply = await playTurn(chat, wf, 'e1', 'go', history);
    expect(reply.writes).toHaveLength(1);
    expect(reply.writes[0]).toMatchObject({ op: 'add', item: { text: 'a fact', messages: { ids: ['m1', 'm2'] } } });
    const post = await playPost(chat, wf, reply, 'go', history);
    expect(post.execution.nodes.fact?.status).toBe('completed');
    expect(post.writes.map((write) => write.nodeId)).toEqual(['consumer']);
    expect(post.execution.warnings).toEqual([
      '"State Write #1 (state-write)" also ran in the reply run, so its state writes were not repeated in this run.',
    ]);
  });
});
