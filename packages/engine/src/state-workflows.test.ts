import { describe, expect, it } from 'vitest';
import { collection, edge, graph, node } from './test-collections.js';
import { newChat, playTurn } from './test-state.js';

// Node ids are only unique within a workflow: a node's own state (Draw's memory) is its workflow's.

const deck = collection('deck', [{ text: 'storm' }]);
const drawing = (id: string) => ({
  ...graph(
    [
      node('input', 'chat-input'),
      node('pick', 'draw', { collectionIds: ['deck'], avoidRecent: 1 }),
      node('output', 'chat-output'),
    ],
    [edge('pick', 'reason', 'output', 'value')],
  ),
  id,
});
const chat = () => newChat([], { collections: { get: async (id: string) => (id === 'deck' ? deck : undefined) } });
const said = (result: { replies: Array<{ content: string }> }) => result.replies[0]!.content;

describe('a node’s own state in several workflows', () => {
  it('stores the node’s writes under the run’s workflow', async () => {
    const result = await playTurn(chat(), drawing('wf-a'), 't1');
    expect(result.writes).toHaveLength(1);
    expect(result.writes[0]!.target).toEqual({ kind: 'node', nodeId: 'pick', key: 'draws', workflowId: 'wf-a' });
  });

  it('keeps two workflows’ nodes with the same id apart', async () => {
    const played = chat();
    expect(said(await playTurn(played, drawing('wf-a'), 't1'))).toBe('drew 1 of 1 eligible');
    // The other workflow's `pick` has not drawn: with one shared memory, turn 2 would find the storm recent.
    expect(said(await playTurn(played, drawing('wf-b'), 't2'))).toBe('drew 1 of 1 eligible');
    // wf-a drew in turn 1 (outside its window of 1 now) and wf-b in turn 2; each reads only its own.
    expect(said(await playTurn(played, drawing('wf-a'), 't3'))).toBe('drew 1 of 1 eligible');
    expect(said(await playTurn(played, drawing('wf-b'), 't4'))).toBe('drew 1 of 1 eligible');
    expect(said(await playTurn(played, drawing('wf-b'), 't5'))).toBe('no eligible entry among 1 (1 recent excluded)');
  });

  it('still reads writes made before chats ran several workflows (no workflow id)', async () => {
    const played = chat();
    const legacy = await playTurn(played, drawing('wf-a'), 't1');
    // A stored write from the single-workflow days has no workflow id.
    const [write] = legacy.writes;
    played.state = {
      turns: [
        {
          executionId: 't1',
          at: '',
          completed: true,
          replies: 1,
          writes: [{ ...write, target: { kind: 'node', nodeId: 'pick', key: 'draws' } }],
        },
      ],
    };
    expect(said(await playTurn(played, drawing('wf-a'), 't2'))).toBe('no eligible entry among 1 (1 recent excluded)');
    played.state = { turns: [(played.state as { turns: unknown[] }).turns[0]] };
    played.messages = played.messages.filter((message) => message.executionId === 't1');
    expect(said(await playTurn(played, drawing('wf-b'), 't3'))).toBe('no eligible entry among 1 (1 recent excluded)');
  });
});
