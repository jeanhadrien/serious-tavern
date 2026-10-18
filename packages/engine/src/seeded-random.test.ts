import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { hashSeed, type ChatMessage, type Edge, type Workflow } from '@st/shared';
import { ExecutionFailure, executeWorkflow } from './executor.js';
import { createRandom } from './seeded-random.js';
import { registry } from './registry.js';

const draws = (next: () => number, count: number) => Array.from({ length: count }, () => next());

describe('createRandom', () => {
  it('is pinned to cyrb128 + canonical sfc32 (old runs must stay reproducible from their seed)', () => {
    // Same values as the reference sfc32 over cyrb128, so a run can be replayed with any stock implementation.
    expect(draws(createRandom('seed:node'), 3)).toEqual([0.90553287579678, 0.156456382246688, 0.366777990013361]);
  });
  it('gives the same sequence for the same seed', () => {
    expect(draws(createRandom('turn-1:random'), 20)).toEqual(draws(createRandom('turn-1:random'), 20));
  });
  it('gives independent sequences for different seeds', () => {
    const a = draws(createRandom('s:a'), 20);
    const b = draws(createRandom('s:b'), 20);
    expect(a.some((value, index) => value === b[index])).toBe(false);
    expect(hashSeed('s:a')).not.toEqual(hashSeed('s:b'));
  });
  it('stays in [0, 1) and is spread evenly', () => {
    const values = draws(createRandom('x:y'), 10000);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    const buckets = Array.from({ length: 10 }, () => 0);
    for (const value of values) buckets[Math.floor(value * 10)]!++;
    for (const count of buckets) expect(Math.abs(count - 1000)).toBeLessThanOrEqual(150);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(Math.abs(mean - 0.5)).toBeLessThanOrEqual(0.02);
  });
  it('is used by nodes instead of Math.random', () => {
    const nodesDir = fileURLToPath(new URL('./nodes/', import.meta.url));
    const sources = readdirSync(nodesDir, { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(0);
    const offenders = sources.filter((file) => readFileSync(join(nodesDir, file), 'utf8').includes('Math.random'));
    expect(offenders).toEqual([]);
  });
  it('hashes any text, including the empty string, to four unsigned 32-bit words', () => {
    for (const text of ['', 'a', '🎲 unicode', 'x'.repeat(1000)]) {
      const words = hashSeed(text);
      expect(words).toHaveLength(4);
      for (const word of words) expect(Number.isInteger(word) && word >= 0 && word < 2 ** 32).toBe(true);
    }
  });
});

const node = (id: string, type: string) => ({ id, type, config: {}, position: { x: 0, y: 0 } });
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});
const graph = (nodes: Workflow['nodes'], edges: Edge[]): Workflow => ({
  id: 'workflow',
  name: 'Test',
  nodes,
  edges,
  createdAt: '',
  updatedAt: '',
});
const options = {
  message: 'hello',
  sessionId: 'session',
  history: [] as ChatMessage[],
  secrets: { get: async () => undefined },
};
// Two random-test nodes feed two outputs, so both run in one turn.
const twoRollers = graph(
  [
    node('input', 'chat-input'),
    node('a', 'random-test'),
    node('b', 'random-test'),
    node('out-a', 'chat-output'),
    node('out-b', 'chat-output'),
  ],
  [edge('a', 'value', 'out-a', 'value'), edge('b', 'value', 'out-b', 'value')],
);
const rolled = (execution: { nodes: Record<string, { output?: unknown }> }, id: string) =>
  (execution.nodes[id]!.output as { value: number[] }).value;

describe('run seed', () => {
  afterEach(() => {
    registry.delete('random-test');
    registry.delete('random-fail-test');
  });
  const register = () =>
    registry.set('random-test', {
      type: 'random-test',
      label: 'Random test',
      description: '',
      category: '',
      inputs: [],
      outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
      configSchema: z.object({}),
      defaultConfig: {},
      execute: async (ctx) => ({ value: [ctx.random(), ctx.random()] }),
    });

  it('generates and records a fresh seed when none is given', async () => {
    register();
    const first = await executeWorkflow(twoRollers, options);
    const second = await executeWorkflow(twoRollers, options);
    expect(first.execution.seed).toEqual(expect.any(String));
    expect(first.execution.seed).not.toBe('');
    expect(second.execution.seed).not.toBe(first.execution.seed);
    expect(rolled(second.execution, 'a')).not.toEqual(rolled(first.execution, 'a'));
  });

  it('records a given seed verbatim and repeats every roll with it', async () => {
    register();
    const first = await executeWorkflow(twoRollers, { ...options, seed: 'fixed' });
    const second = await executeWorkflow(twoRollers, { ...options, seed: 'fixed' });
    expect(first.execution.seed).toBe('fixed');
    expect(second.execution.nodes).toMatchObject({
      a: { output: first.execution.nodes.a?.output },
      b: { output: first.execution.nodes.b?.output },
    });
    expect(second.replies).toEqual(first.replies);
    expect((await executeWorkflow(twoRollers, { ...options, seed: '' })).execution.seed).toBe('');
  });

  it('draws each node from the stream of "<seed>:<node id>", advancing on every call', async () => {
    register();
    const { execution } = await executeWorkflow(twoRollers, { ...options, seed: 'fixed' });
    expect(rolled(execution, 'a')).toEqual(draws(createRandom('fixed:a'), 2));
    expect(rolled(execution, 'b')).toEqual(draws(createRandom('fixed:b'), 2));
    expect(rolled(execution, 'a')).not.toEqual(rolled(execution, 'b'));
    const other = await executeWorkflow(twoRollers, { ...options, seed: 'other' });
    expect(rolled(other.execution, 'a')).not.toEqual(rolled(execution, 'a'));
  });

  it('records the seed of a failed run', async () => {
    registry.set('random-fail-test', {
      type: 'random-fail-test',
      label: 'Random fail test',
      description: '',
      category: '',
      inputs: [],
      outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
      configSchema: z.object({}),
      defaultConfig: {},
      execute: async (ctx) => {
        throw new Error(`rolled ${ctx.random()}`);
      },
    });
    const failing = graph(
      [node('input', 'chat-input'), node('roll', 'random-fail-test'), node('output', 'chat-output')],
      [edge('roll', 'value', 'output', 'value')],
    );
    const failure = await executeWorkflow(failing, { ...options, seed: 'broken' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ExecutionFailure);
    expect((failure as ExecutionFailure).execution.seed).toBe('broken');
    expect((failure as ExecutionFailure).execution.nodes.roll?.error).toBe(`rolled ${createRandom('broken:roll')()}`);
  });
});
