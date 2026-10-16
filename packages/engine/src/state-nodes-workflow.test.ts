import { describe, expect, it } from 'vitest';
import type { StateDefinition } from '@st/shared';
import { validateWorkflow } from './executor.js';
import { edge, graph, node } from './test-collections.js';
import { SCENE_ID, deleteReplies, newChat, playTurn, sceneDefinition } from './test-state.js';

const scene: StateDefinition = sceneDefinition;
const key = (name: string) => ({ kind: 'definition' as const, definitionId: SCENE_ID, key: name });
const write = (key_: string, op: string) => ({ definitionId: SCENE_ID, key: key_, op });
const read = (key_: string, mode = 'value') => ({ definitionId: SCENE_ID, key: key_, read: mode });
const replies = (result: { replies: Array<{ content: string }> }) => result.replies.map((reply) => reply.content);

// input -> output (the message), plus an unconnected increment of scene.tension: no reply depends on it.
const counting = () =>
  graph(
    [
      node('input', 'chat-input'),
      node('output', 'chat-output'),
      node('bump', 'state-write', write('tension', 'increment')),
    ],
    [edge('input', 'message', 'output', 'value')],
  );

describe('State Write in a workflow', () => {
  it('runs every turn although no Chat Output depends on it, and its writes accumulate', async () => {
    const chat = newChat([scene]);
    const wf = counting();
    expect(await validateWorkflow(wf, chat.resources)).toEqual([]);
    const first = await playTurn(chat, wf, 'e1');
    const second = await playTurn(chat, wf, 'e2');
    const third = await playTurn(chat, wf, 'e3');
    expect(first.execution.nodes.bump?.status).toBe('completed');
    expect([first, second, third].map((result) => result.writes)).toEqual([
      [{ op: 'set', target: key('tension'), nodeId: 'bump', value: 4 }],
      [{ op: 'set', target: key('tension'), nodeId: 'bump', value: 5 }],
      [{ op: 'set', target: key('tension'), nodeId: 'bump', value: 6 }],
    ]);
  });

  it('is skipped, and writes nothing, when the Condition branch feeding it is not taken', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('gate', 'condition', { left: '{{input.value}}', operator: 'equals', right: 'yes' }),
        node('mark', 'state-write', write('note', 'set')),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('input', 'message', 'gate', 'value'),
        edge('gate', 'true', 'mark', 'value'),
      ],
    );
    const chat = newChat([scene]);
    const no = await playTurn(chat, wf, 'e1', 'no');
    expect(no.execution.nodes.mark?.status).toBe('skipped');
    expect(no.writes).toEqual([]);
    const yes = await playTurn(chat, wf, 'e2', 'yes');
    expect(yes.writes).toEqual([{ op: 'set', target: key('note'), nodeId: 'mark', value: 'yes' }]);
  });

  it('reads the start-of-turn value in its own run, and the next turn sees what was written', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('look', 'state-read', read('tension')),
        node('bump', 'state-write', write('tension', 'increment')),
      ],
      [edge('look', 'value', 'output', 'value')],
    );
    const chat = newChat([scene]);
    expect(replies(await playTurn(chat, wf, 'e1'))).toEqual(['3']);
    expect(replies(await playTurn(chat, wf, 'e2'))).toEqual(['4']);
    expect(replies(await playTurn(chat, wf, 'e3'))).toEqual(['5']);
    // Deleting the last reply undoes its write: the next turn starts from the previous value again.
    deleteReplies(chat, 'e3');
    expect(replies(await playTurn(chat, wf, 'e4'))).toEqual(['5']);
  });

  it('passes the new value on, so a Chat Output can show it in the same turn', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('bump', 'state-write', write('tension', 'increment')),
        node('output', 'chat-output'),
      ],
      [edge('bump', 'value', 'output', 'value')],
    );
    const chat = newChat([scene]);
    expect(replies(await playTurn(chat, wf, 'e1'))).toEqual(['4']);
    expect(replies(await playTurn(chat, wf, 'e2'))).toEqual(['5']);
  });

  it('reports meta facts that change as turns pass', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output', { template: '{{input.value}}' }),
        node('since', 'state-read', read('note', 'meta')),
        node('mark', 'state-write', write('note', 'set')),
        node('gate', 'condition', { left: '{{input.value}}', operator: 'equals', right: 'write' }),
      ],
      [
        edge('input', 'message', 'gate', 'value'),
        edge('gate', 'true', 'mark', 'value'),
        edge('since', 'turnsSinceWrite', 'output', 'value'),
      ],
    );
    const chat = newChat([scene]);
    // Never written counts as written before turn 1.
    expect(replies(await playTurn(chat, wf, 'e1', 'skip'))).toEqual(['1']);
    expect(replies(await playTurn(chat, wf, 'e2', 'write'))).toEqual(['2']);
    expect(replies(await playTurn(chat, wf, 'e3', 'skip'))).toEqual(['1']);
    expect(replies(await playTurn(chat, wf, 'e4', 'skip'))).toEqual(['2']);
  });

  it('collects items across turns, newest first', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output', { template: '{{#each state.scene.plain}}{{this.text}},{{/each}}' }),
        node('add', 'state-write', write('plain', 'add')),
      ],
      [edge('input', 'message', 'output', 'value'), edge('input', 'message', 'add', 'value')],
    );
    const chat = newChat([scene]);
    expect(replies(await playTurn(chat, wf, 'e1', 'a'))).toEqual(['']);
    expect(replies(await playTurn(chat, wf, 'e2', 'b'))).toEqual(['a,']);
    expect(replies(await playTurn(chat, wf, 'e3', 'c'))).toEqual(['b,a,']);
    const fourth = await playTurn(chat, wf, 'e4', 'd');
    expect(fourth.writes.map((item) => item.op === 'add' && item.item.id)).toEqual(['e4:add:1']);
  });

  it('gives items from two nodes in one turn different ids', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('one', 'state-write', write('plain', 'add')),
        node('two', 'state-write', write('plain', 'add')),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('input', 'message', 'one', 'value'),
        edge('input', 'message', 'two', 'value'),
      ],
    );
    const chat = newChat([scene]);
    const result = await playTurn(chat, wf, 'exec');
    expect(result.writes.map((item) => item.op === 'add' && item.item.id)).toEqual(['exec:one:1', 'exec:two:1']);
  });

  it('fails validation, in plain words, for a definition that does not exist', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('bump', 'state-write', { definitionId: 'gone', key: 'tension', op: 'increment' }),
      ],
      [edge('input', 'message', 'output', 'value')],
    );
    const issues = await validateWorkflow(wf, newChat([scene]).resources);
    expect(issues.map((issue) => issue.message)).toEqual([
      '"State Write #1 (state-write)" could not resolve its ports: State definition gone not found',
    ]);
  });
});
