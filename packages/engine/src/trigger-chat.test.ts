import { describe, expect, it } from 'vitest';
import { edge, graph, node } from './test-collections.js';
import { deleteReplies, newChat, playTurn } from './test-state.js';

// A Trigger that always passes its roll (score 1.5 capped to 1), so only the levels and cooldowns decide.
const triggering = (config: Record<string, unknown>) =>
  graph(
    [
      node('input', 'chat-input'),
      node('trigger', 'trigger', { baseChance: 1, growthPerTurn: 0, volatility: 1, ...config }),
      node('output', 'chat-output'),
    ],
    [edge('trigger', 'reason', 'output', 'value')],
  );
const fired = (turn: Awaited<ReturnType<typeof playTurn>>) => turn.writes.length === 1;

describe('Trigger across turns', () => {
  it('remembers a firing under its own node key and enforces the cooldown of its level', async () => {
    const chat = newChat([]);
    const wf = triggering({ maxLevel: 1, cooldowns: { '1': 3 } });
    const turns = [];
    for (let n = 1; n <= 7; n++) turns.push(await playTurn(chat, wf, `e${n}`));
    // A cooldown of 3 turns between level 1 firings: turns 1, 4 and 7.
    expect(turns.map(fired)).toEqual([true, false, false, true, false, false, true]);
    expect(turns[0]!.writes[0]).toMatchObject({
      op: 'add',
      target: { kind: 'node', nodeId: 'trigger', key: 'fires' },
      item: { text: 'fired at level 1', level: 1 },
    });
    expect(turns[1]!.replies[0]!.content).toContain('level 1 on cooldown for 2 more turns');
    expect(turns[2]!.replies[0]!.content).toContain('level 1 on cooldown for 1 more turn;');
  });

  it('counts the turns since the last firing from the folded state', async () => {
    const chat = newChat([]);
    // Never a firing: base 0 and growth 0.1 give 0.1 × turns, times the factor 1.
    const wf = triggering({
      baseChance: 0,
      growthPerTurn: 0.1,
      volatility: 0.5,
      maxLevel: 5,
      levelWeights: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
    });
    const first = await playTurn(chat, wf, 'e1');
    const second = await playTurn(chat, wf, 'e2');
    expect(first.replies[0]!.content).toContain('score 0.1 = (0 + 0.1×1)');
    expect(second.replies[0]!.content).toContain('score 0.2 = (0 + 0.1×2)');
  });

  it('forgets a firing, and so its cooldown and its growth reset, when its reply is deleted', async () => {
    const chat = newChat([]);
    const wf = triggering({ maxLevel: 1, cooldowns: { '1': 3 } });
    expect(fired(await playTurn(chat, wf, 'e1'))).toBe(true);
    expect(fired(await playTurn(chat, wf, 'e2'))).toBe(false);
    deleteReplies(chat, 'e1');
    // Without the deletion level 1 would still be cooling down after turn 1.
    expect(fired(await playTurn(chat, wf, 'e3'))).toBe(true);
  });

  it('keeps a firing whose reply stays when a later reply is deleted', async () => {
    const chat = newChat([]);
    const wf = triggering({ maxLevel: 1, cooldowns: { '1': 3 } });
    await playTurn(chat, wf, 'e1');
    await playTurn(chat, wf, 'e2');
    deleteReplies(chat, 'e2');
    const next = await playTurn(chat, wf, 'e3');
    // Turn 1 still counts, so this is turn 2 of the chat's present replies: 1 turn since the firing.
    expect(fired(next)).toBe(false);
    expect(next.replies[0]!.content).toContain('level 1 on cooldown for 2 more turns');
  });

  it('keeps a cooldown for each level, so two levels alternate', async () => {
    const chat = newChat([]);
    const wf = triggering({ maxLevel: 2, cooldowns: { '1': 2, '2': 2 } });
    const levels: number[] = [];
    for (let n = 1; n <= 6; n++) {
      const [write] = (await playTurn(chat, wf, `e${n}`)).writes;
      levels.push(write?.op === 'add' ? (write.item.level as number) : 0);
    }
    // Each level rests for two turns after it fired, so whichever starts, the other follows.
    expect(levels.every((level) => level === 1 || level === 2)).toBe(true);
    for (let turn = 1; turn < levels.length; turn++) expect(levels[turn]).not.toBe(levels[turn - 1]);
  });
});
