import { describe, expect, it } from 'vitest';
import type { StateDefinition, StateKeyDef } from './definition.js';
import { foldStoryState } from './fold.js';
import type { FoldedKey } from './fold-types.js';
import { oracleFold, type Expected } from './test-oracle.js';
import type { PresenceMessage } from './turns.js';
import type { StateWrite, TurnEntry } from './writes.js';

// Randomized check of the fold against an independent naive oracle (test-oracle.ts), plus the properties
// the design promises: purity, determinism, rewind on deleting the last reply, user rows never matter.

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = ReturnType<typeof createRng>;
function createRng(seed: number) {
  const next = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]): T => list[int(0, list.length - 1)]!,
  };
}

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
};

function randomKey(rng: Rng): StateKeyDef {
  switch (rng.int(0, 7)) {
    case 0: {
      const min = rng.chance(0.6) ? rng.int(-3, 2) : undefined;
      const max = rng.chance(0.6) ? rng.int(3, 9) : undefined;
      return { type: 'number', min, max };
    }
    case 1:
      return { type: 'boolean' };
    case 2:
      return { type: 'enum', options: ['a', 'b', 'c'].slice(0, rng.int(1, 3)) };
    case 3:
      return { type: 'text', default: rng.chance(0.5) ? 'dflt' : undefined };
    case 4:
      return { type: 'object', default: rng.chance(0.5) ? { d: 1 } : undefined };
    default:
      return { type: 'collection', cap: rng.chance(0.7) ? rng.int(1, 3) : undefined };
  }
}

const junk = (rng: Rng): unknown =>
  rng.pick([-5, 0, 2, 7, 11, 2.5, 'a', 'b', 'zz', '', true, false, null, [], [1], {}, { d: 2 }]);

function randomDefinitions(rng: Rng): StateDefinition[] {
  return Array.from({ length: rng.int(1, 3) }, (_, d) => ({
    id: `def-${d}`,
    name: `d${d}`,
    createdAt: '',
    updatedAt: '',
    keys: Object.fromEntries(Array.from({ length: rng.int(1, 5) }, (_, k) => [`k${k}`, randomKey(rng)])),
  }));
}

function randomWrite(rng: Rng, definitions: StateDefinition[], ids: string[], counter: { n: number }): StateWrite {
  const nodeId = rng.pick(['n1', 'n2', 'n3']);
  const kind = rng.int(0, 9);
  let target: StateWrite['target'];
  let def: StateKeyDef | undefined;
  if (kind <= 6) {
    const definition = rng.pick(definitions);
    const lists = Object.keys(definition.keys).filter((name) => definition.keys[name]?.type === 'collection');
    const key = rng.chance(0.05)
      ? 'ghost'
      : rng.pick(lists.length && rng.chance(0.5) ? lists : Object.keys(definition.keys));
    target = { kind: 'definition', definitionId: rng.chance(0.05) ? 'unknown-def' : definition.id, key };
    def = definition.keys[key];
  } else target = { kind: 'node', nodeId, key: rng.pick(['draws', 'last']) };
  const asList = def ? def.type === 'collection' : target.kind === 'node' && target.key === 'draws';
  // Mostly the ops that suit the key, sometimes the wrong ones.
  const wantList = rng.chance(0.9) ? asList : !asList;
  const roll = rng.int(0, 9);
  if (roll === 0) return { op: 'delete', target, nodeId };
  if (wantList) {
    if (roll <= 5) {
      const id = `i${counter.n++}`;
      ids.push(id);
      return { op: 'add', target, nodeId, item: { id, text: `t${id}`, level: rng.int(1, 3) } };
    }
    const itemId = ids.length && rng.chance(0.8) ? rng.pick(ids) : 'no-such-item';
    if (roll <= 7) {
      const text = rng.chance(0.7) ? { text: `u${counter.n++}` } : {};
      const fields = rng.chance(0.5) ? { fields: rng.pick([{ level: rng.int(1, 3) }, { id: 'x', messages: 1 }]) } : {};
      return { op: 'update', target, nodeId, itemId, ...text, ...fields };
    }
    return { op: 'remove', target, nodeId, itemId };
  }
  const value = def?.type === 'enum' && rng.chance(0.7) ? rng.pick(def.options) : junk(rng);
  return { op: 'set', target, nodeId, value };
}

type Scenario = {
  definitions: StateDefinition[];
  entries: TurnEntry[];
  messages: PresenceMessage[];
};

function scenario(seed: number): Scenario {
  const rng = createRng(seed);
  const written = randomDefinitions(rng);
  const ids: string[] = [];
  const counter = { n: 0 };
  const entries: TurnEntry[] = [];
  const messages: PresenceMessage[] = [];
  for (let t = 0; t < rng.int(1, 12); t++) {
    const executionId = `e${t}`;
    const replies = rng.chance(0.2) ? 0 : rng.int(1, 3);
    entries.push({
      executionId,
      at: '',
      completed: rng.chance(0.8),
      replies,
      writes: Array.from({ length: rng.int(0, 8) }, () => randomWrite(rng, written, ids, counter)),
    });
    if (rng.chance(0.8)) messages.push({ role: 'user', executionId });
    for (let r = 0; r < replies; r++)
      messages.push({
        role: 'assistant',
        executionId,
        status: rng.pick([undefined, 'final', 'final', 'partial', 'streaming']),
      });
  }
  // The user deletes messages ...
  const kept = messages.filter(() => !rng.chance(0.25));
  // ... and edits a definition afterwards: a changed type, bounds or cap, or a removed key.
  const definitions = written.map((definition) => {
    const keys = { ...definition.keys };
    for (const key of Object.keys(keys)) {
      if (rng.chance(0.12)) delete keys[key];
      else if (rng.chance(0.15)) keys[key] = randomKey(rng);
    }
    return { ...definition, keys };
  });
  return { definitions, entries, messages: kept };
}

const run = ({ definitions, entries, messages }: Scenario) =>
  foldStoryState({ definitions, messages, state: { turns: entries } });

function expectKey(actual: FoldedKey | undefined, expected: Expected) {
  expect(actual, 'key').toBeDefined();
  expect(actual!.value).toEqual(expected.value);
  expect(actual!.meta).toEqual({
    written: expected.written,
    turnsSinceWrite: expected.turnsSinceWrite,
    writtenAtTurn: expected.writtenAtTurn,
    ...(expected.count !== undefined && { count: expected.count, droppedByCap: expected.droppedByCap }),
  });
  expect(actual!.history).toEqual(expected.history);
  expect(actual!.itemTurns).toEqual(expected.itemTurns);
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

// One test per property rather than 300 tests: a failure names the seed, which replays the scenario.
function forEachSeed(check: (seed: number) => void) {
  for (const seed of SEEDS) {
    try {
      check(seed);
    } catch (error) {
      throw new Error(`seed ${seed}: ${(error as Error).message}`, { cause: error });
    }
  }
}

describe('fold against a naive oracle', () => {
  it('matches the oracle for 300 random scenarios, with the input deep-frozen', () => {
    forEachSeed((seed) => {
      const input = scenario(seed);
      deepFreeze(input);
      const story = run(input);
      const expected = oracleFold(input.definitions, input.entries, input.messages);

      expect(story.turn).toBe(expected.turn);
      expect(story.definitions.map((d) => d.definitionId)).toEqual(input.definitions.map((d) => d.id));
      for (const folded of story.definitions) {
        const keys = expected.keys[folded.definitionId]!;
        expect(Object.keys(folded.keys)).toEqual(Object.keys(keys));
        for (const [key, value] of Object.entries(folded.keys)) expectKey(value, keys[key]!);
        expect(folded.warnings, 'warnings').toHaveLength(expected.warnings[folded.definitionId]!);
      }
      expect(story.nodes.map((n) => n.nodeId)).toEqual(Object.keys(expected.nodes).sort());
      for (const node of story.nodes) {
        expect(Object.keys(node.keys).sort()).toEqual(Object.keys(expected.nodes[node.nodeId]!).sort());
        for (const [key, value] of Object.entries(node.keys)) expectKey(value, expected.nodes[node.nodeId]![key]!);
      }
    });
  });
});

describe('fold properties', () => {
  it('is deterministic and leaves its input alone', () => {
    forEachSeed((seed) => {
      const input = scenario(seed);
      const before = structuredClone(input);
      expect(run(input)).toEqual(run(input));
      expect(input).toEqual(before);
    });
  });

  it('rewinds when the last present turn loses its replies', () => {
    let checked = 0;
    forEachSeed((seed) => {
      const input = scenario(seed);
      const story = run(input);
      const last = [...story.turns].reverse().find((presence) => presence.turn !== null);
      if (!last || last.entry.replies === 0) return;
      checked++;
      const { executionId } = last.entry;
      const without = {
        ...input,
        messages: input.messages.filter((m) => !(m.role === 'assistant' && m.executionId === executionId)),
      };
      const rewound = run(without);
      const dropped = run({ ...input, entries: input.entries.filter((e) => e.executionId !== executionId) });
      expect(rewound.turn).toBe(story.turn - 1);
      expect(rewound.definitions).toEqual(dropped.definitions);
      expect(rewound.nodes).toEqual(dropped.nodes);
    });
    expect(checked).toBeGreaterThan(100);
  });

  it('ignores user messages', () => {
    forEachSeed((seed) => {
      const input = scenario(seed);
      const withoutUsers = { ...input, messages: input.messages.filter((m) => m.role !== 'user') };
      expect(run(withoutUsers)).toEqual(run(input));
    });
  });

  it('actually exercises every branch across the seeds', () => {
    // A guard for the generator: if it stopped producing these, the oracle test would prove nothing.
    const seen = { collections: 0, bad: 0, ghost: 0, nodes: 0, absent: 0, capped: 0 };
    for (const seed of SEEDS) {
      const story = run(scenario(seed));
      for (const d of story.definitions) {
        for (const key of Object.values(d.keys)) {
          if (key.meta.count) seen.collections++;
          if (key.meta.droppedByCap) seen.capped++;
        }
        if (d.warnings.length) seen.bad++;
        if (d.warnings.some((w) => w.message.startsWith('The definition no longer'))) seen.ghost++;
      }
      seen.nodes += story.nodes.length;
      seen.absent += story.turns.filter((t) => t.turn === null).length;
    }
    for (const [name, count] of Object.entries(seen)) expect(count, name).toBeGreaterThan(30);
  });
});
