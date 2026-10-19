import { describe, expect, it } from 'vitest';
import { canConnect } from '@st/shared';
import { registry } from './registry.js';
import { executeWorkflow } from './executor.js';
import { pacing } from './nodes/pacing/index.js';
import { validateWorkflow } from './prepare.js';
import { edge, graph, node, resourcesWith, runNode } from './test-collections.js';
import { deleteReplies, newChat, playTurn, snapshotOf } from './test-state.js';

const resources = resourcesWith();
// What the node recorded under `beats` in earlier turns, as a snapshot reads it (newest first).
const beats = (...items: Record<string, unknown>[]) =>
  snapshotOf([], {
    turn: items.length + 1,
    nodes: {
      pacing: {
        beats: {
          value: items.map((item, index) => ({ id: `i${index}`, text: 't', ...item })).reverse(),
          itemTurns: items.map((_, index) => index + 1).reverse(),
        },
      },
    },
  });

describe('Pacing ports and config', () => {
  it('is registered under Creativity with the documented ports', () => {
    expect(registry.get('pacing')).toBe(pacing);
    expect(pacing.category).toBe('Creativity');
    expect(pacing.inputs.map((port) => [port.name, port.dataType, !!port.neverSkips])).toEqual([
      ['tension', 'number', true],
      ['hold', 'boolean', true],
    ]);
    expect(pacing.outputs.map((port) => [port.name, port.dataType])).toEqual([
      ['phase', 'text'],
      ['intensity', 'number'],
      ['maxLevel', 'number'],
      ['pressure', 'number'],
      ['turnsInPhase', 'number'],
      ['guidance', 'text'],
      ['reason', 'text'],
    ]);
    expect(pacing.configSchema.parse(pacing.defaultConfig)).toEqual(pacing.configSchema.parse({}));
    expect(canConnect('number', 'number').ok).toBe(true);
    expect(canConnect('boolean', 'boolean').ok).toBe(true);
  });
});

describe('Pacing node', () => {
  it('starts a build on a fresh chat and records the turn under its own key', async () => {
    const { output, writes } = await runNode(pacing, {}, { resources });
    expect(output).toMatchObject({
      phase: 'build',
      turnsInPhase: 1,
      maxLevel: 2,
      pressure: 0,
      intensity: expect.any(Number),
    });
    expect(String(output.guidance)).toContain('Build:');
    expect(writes).toMatchObject([
      { op: 'add', target: { kind: 'node', nodeId: 'pacing', key: 'beats' }, item: { text: 'build, turn 1' } },
    ]);
    expect(writes[0]).not.toHaveProperty('item.tension');
  });

  it('records the tension and the hold it was given', async () => {
    const { writes } = await runNode(pacing, {}, { resources, inputs: { tension: 0.4, hold: true } });
    expect(writes[0]).toMatchObject({ item: { tension: 0.4, hold: true } });
  });

  it('continues from the recorded turns', async () => {
    // Seven beat-clock turns: a build at turn 7, the 8th is its last.
    const state = beats(...Array.from({ length: 7 }, () => ({})));
    const { output } = await runNode(pacing, {}, { resources, state });
    expect(output).toMatchObject({ phase: 'build', turnsInPhase: 8, maxLevel: 4, pressure: 1 });
    const next = await runNode(pacing, {}, { resources, state: beats(...Array.from({ length: 8 }, () => ({}))) });
    expect(next.output).toMatchObject({ phase: 'peak', turnsInPhase: 1, maxLevel: 5 });
    expect(next.output.reason).toContain('build → peak');
  });

  it('lets a tension input push a build into its peak and clamps it', async () => {
    const state = beats({}, {});
    const high = await runNode(pacing, {}, { resources, state, inputs: { tension: 0.95 } });
    expect(high.output).toMatchObject({ phase: 'peak', intensity: 0.95 });
    const over = await runNode(pacing, {}, { resources, state, inputs: { tension: '3' } });
    expect(over.output).toMatchObject({ phase: 'peak', intensity: 1 });
    expect(over.writes[0]).toMatchObject({ item: { tension: 1 } });
  });

  it('does not advance the phase while hold is true', async () => {
    const state = beats({}, {}, {});
    const held = await runNode(pacing, {}, { resources, state, inputs: { hold: true } });
    expect(held.output).toMatchObject({ phase: 'build', turnsInPhase: 3 });
    const free = await runNode(pacing, {}, { resources, state, inputs: { hold: false } });
    expect(free.output).toMatchObject({ phase: 'build', turnsInPhase: 4 });
  });

  it('replays hold turns recorded earlier', async () => {
    const { output } = await runNode(pacing, {}, { resources, state: beats({}, { hold: true }, { hold: true }) });
    expect(output).toMatchObject({ phase: 'build', turnsInPhase: 2 });
  });

  it('rejects text that is not a number as tension and a non-boolean hold', async () => {
    await expect(runNode(pacing, {}, { resources, inputs: { tension: 'high' } })).rejects.toThrow(
      'Tension must be a number, got "high"',
    );
    await expect(runNode(pacing, {}, { resources, inputs: { hold: 'yes' } })).rejects.toThrow(
      'Hold must be true or false',
    );
  });

  it('reads a hand-edited or older value without breaking', async () => {
    for (const value of [null, 'text', 5, [null, 'x', { tension: 'no', hold: 'yes' }, { tension: Number.NaN }]]) {
      const state = snapshotOf([], { turn: 2, nodes: { pacing: { beats: { value } } } });
      await expect(runNode(pacing, {}, { resources, state })).resolves.toBeDefined();
    }
    const state = snapshotOf([], { turn: 2, nodes: { pacing: { beats: { value: [{ tension: 'no' }] } } } });
    expect((await runNode(pacing, {}, { resources, state })).output).toMatchObject({ phase: 'build', turnsInPhase: 2 });
  });

  it('uses the configured phases and guidance', async () => {
    const state = beats({}, {});
    const { output } = await runNode(
      pacing,
      { maxBuildTurns: 2, guidancePeak: 'Climax now.', peakLevel: 3 },
      { resources, state },
    );
    expect(output).toMatchObject({ phase: 'peak', guidance: 'Climax now.', maxLevel: 3 });
  });
});

// Chat Input → (message parsed as a number or a boolean) → Pacing → its reason as the reply.
const director = (wire: 'none' | 'tension' | 'hold', config: Record<string, unknown> = {}) =>
  graph(
    [
      node('input', 'chat-input'),
      ...(wire === 'none' ? [] : [node('parse', 'parse-json', { expect: wire === 'hold' ? 'boolean' : 'number' })]),
      node('pacing', 'pacing', config),
      node('output', 'chat-output'),
    ],
    [
      ...(wire === 'none' ? [] : [edge('input', 'message', 'parse', 'text'), edge('parse', 'value', 'pacing', wire)]),
      edge('pacing', 'reason', 'output', 'value'),
    ],
  );
const reasonOf = (turn: Awaited<ReturnType<typeof playTurn>>) => turn.replies[0]!.content;
// The phase a turn ended in: after the arrow of a transition, else the first word.
const phaseOf = (turn: Awaited<ReturnType<typeof playTurn>>) =>
  /→ (\w+)/.exec(reasonOf(turn))?.[1] ?? /^(?:holding )?(\w+)/.exec(reasonOf(turn))![1];

describe('Pacing across turns', () => {
  it('runs the beat clock and advances once per turn, even for an empty send', async () => {
    const chat = newChat([]);
    const wf = director('none', { maxBuildTurns: 2, peakTurns: 1, fadeTurns: 1, relaxTurns: 1 });
    const phases = [];
    for (let n = 1; n <= 6; n++) phases.push(phaseOf(await playTurn(chat, wf, `e${n}`, n === 3 ? '' : 'go')));
    expect(phases).toEqual(['build', 'build', 'peak', 'fade', 'relax', 'build']);
  });

  it('follows the tension turn by turn', async () => {
    const chat = newChat([]);
    const wf = director('tension');
    const turns = [];
    for (const [n, tension] of ['0.1', '0.3', '0.8', '0.2', '0', '0'].entries())
      turns.push(await playTurn(chat, wf, `e${n}`, tension));
    expect(turns.map(phaseOf)).toEqual(['build', 'build', 'peak', 'peak', 'fade', 'fade']);
    expect(reasonOf(turns[2]!)).toContain('build → peak intensity 0.8 reached the peak threshold 0.7');
    expect(reasonOf(turns[4]!)).toContain('peak → fade after 2 turns');
  });

  it('holds on a hold turn and carries on after it', async () => {
    const chat = newChat([]);
    const wf = director('hold');
    const reasons = [];
    for (const [n, hold] of ['false', 'true', 'true', 'false'].entries())
      reasons.push(reasonOf(await playTurn(chat, wf, `e${n}`, hold)).split(';')[0]);
    expect(reasons).toEqual([
      'build, turn 1',
      'holding build at turn 1 (hold is on)',
      'holding build at turn 1 (hold is on)',
      'build, turn 2',
    ]);
  });

  it('goes back with a deleted reply: the last one, and one from the middle', async () => {
    const chat = newChat([]);
    const wf = director('none', { maxBuildTurns: 3, peakTurns: 5 });
    const turns = [];
    for (let n = 1; n <= 4; n++) turns.push(await playTurn(chat, wf, `e${n}`));
    expect(turns.map(phaseOf)).toEqual(['build', 'build', 'build', 'peak']);

    // The last reply: the same turn comes out the same again.
    deleteReplies(chat, 'e4');
    expect(reasonOf(await playTurn(chat, wf, 'e5'))).toBe(reasonOf(turns[3]!));

    // A middle reply: the chat now has three turns before the next one, so the build still has its last turn to go.
    // A director that kept its state instead of recomputing it would carry on in the peak.
    deleteReplies(chat, 'e2');
    const next = await playTurn(chat, wf, 'e6');
    expect(reasonOf(next)).toContain('build → peak');
    deleteReplies(chat, 'e1');
    expect(reasonOf(await playTurn(chat, wf, 'e7'))).toContain('build → peak');
  });
});

describe('Pacing wired to a Trigger', () => {
  const wired = graph(
    [
      node('input', 'chat-input'),
      node('pacing', 'pacing'),
      node('trigger', 'trigger', {
        baseChance: 1,
        growthPerTurn: 0,
        volatility: 0.5,
        signals: [{ name: 'pressure', weight: 1 }],
      }),
      node('output', 'chat-output'),
    ],
    [
      edge('pacing', 'maxLevel', 'trigger', 'maxLevel'),
      edge('pacing', 'pressure', 'trigger', 'pressure'),
      edge('trigger', 'reason', 'output', 'value'),
    ],
  );

  it('validates, and the Trigger takes the max level and the pressure', async () => {
    expect(await validateWorkflow(wired, { ...resources, stateDefinitions: { get: async () => undefined } })).toEqual(
      [],
    );
    const chat = newChat([]);
    const first = await playTurn(chat, wired, 'e1');
    // Build turn 1: pressure 0 and max level 2; the last build turn: pressure 1 and max level 4.
    expect(first.replies[0]!.content).toContain('1×0 pressure');
    expect(first.replies[0]!.content).toContain('levels above max level 2 left out');
    for (let n = 2; n <= 7; n++) await playTurn(chat, wired, `e${n}`);
    const last = await playTurn(chat, wired, 'e8');
    expect(last.replies[0]!.content).toContain('1×1 pressure');
    expect(last.replies[0]!.content).toContain('levels above max level 4 left out');
  });

  it('runs without state tracking too', async () => {
    const result = await executeWorkflow(wired, {
      message: 'hi',
      sessionId: 's',
      history: [],
      secrets: { get: async () => undefined },
      resources,
    });
    expect(result.replies).toHaveLength(1);
  });
});
