import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionLog } from '@st/shared';
import { ExecutionFailure, executeWorkflow } from './executor.js';
import { SummaryRun } from './summary-writes.js';
import { edge, graph, node } from './test-collections.js';
import { postOptions, register, run, testType, unregister } from './test-post.js';

afterEach(unregister);

const request = (text: string, ids = ['m1', 'm2']) => ({ set: 'main', messageIds: ids, fingerprint: 'f', text });
const log = (): Pick<ExecutionLog, 'id' | 'warnings'> => ({ id: 'run', warnings: [] });
const active = () => true;

describe('SummaryRun', () => {
  it('shows nodes a frozen copy of the snapshot', () => {
    const stored = {
      main: [{ id: 's', messageIds: ['m1'], fingerprint: 'f', text: 't', createdAt: '', executionId: 'e' }],
    };
    const { summaries } = new SummaryRun(stored, log()).context('a', active);
    expect(summaries).toEqual(stored);
    expect(summaries).not.toBe(stored);
    expect(Object.isFrozen(summaries)).toBe(true);
    expect(new SummaryRun(undefined, log()).context('a', active).summaries).toEqual({});
  });
  it('counts a write only once its node has committed', () => {
    const buffer = new SummaryRun({}, log());
    buffer.context('a', active).writeSummary(request('one'));
    buffer.context('b', active).writeSummary(request('two'));
    buffer.commit('b', 1);
    expect(buffer.finish().map((write) => write.text)).toEqual(['two']);
  });
  it('mints ids from the execution, the node and the call order, and returns them', () => {
    const buffer = new SummaryRun({}, log());
    const { writeSummary } = buffer.context('node', active);
    expect([writeSummary(request('a')).id, writeSummary(request('b')).id]).toEqual(['run:node:1', 'run:node:2']);
    buffer.commit('node', 1);
    expect(buffer.finish()).toEqual([
      { ...request('a'), id: 'run:node:1', nodeId: 'node' },
      { ...request('b'), id: 'run:node:2', nodeId: 'node' },
    ]);
  });
  it('resolves by wave, then node id, then call order, whatever order nodes committed in', () => {
    const buffer = new SummaryRun({}, log());
    for (const [nodeId, wave] of [
      ['z', 1],
      ['b', 2],
      ['a', 2],
    ] as const) {
      const { writeSummary } = buffer.context(nodeId, active);
      writeSummary(request(`${nodeId}1`));
      writeSummary(request(`${nodeId}2`));
      buffer.commit(nodeId, wave);
    }
    expect(buffer.finish().map((write) => write.text)).toEqual(['z1', 'z2', 'a1', 'a2', 'b1', 'b2']);
  });
  it('ignores calls after the node finished or stopped being active', () => {
    const buffer = new SummaryRun({}, log());
    let running = true;
    const { writeSummary } = buffer.context('a', () => running);
    writeSummary(request('early'));
    running = false;
    writeSummary(request('after abort'));
    buffer.commit('a', 1);
    buffer.context('b', active).writeSummary(request('b'));
    buffer.commit('b', 1);
    buffer.context('b', active).writeSummary(request('late'));
    expect(buffer.finish().map((write) => write.text)).toEqual(['early', 'b']);
  });
  it('copies requests, and gives a fresh array each time', () => {
    const buffer = new SummaryRun({}, log());
    const mine = request('a');
    buffer.context('a', active).writeSummary(mine);
    buffer.commit('a', 1);
    mine.messageIds.push('m9');
    const first = buffer.finish();
    expect(first[0]!.messageIds).toEqual(['m1', 'm2']);
    first.pop();
    expect(buffer.finish()).toHaveLength(1);
  });
  it('drops the writes of nodes the reply run also ran, with a warning', () => {
    const execution = log();
    const buffer = new SummaryRun({}, execution, { ids: new Set(['a']), nameOf: (id) => `Node ${id}` });
    buffer.context('a', active).writeSummary(request('repeat'));
    buffer.commit('a', 1);
    buffer.context('b', active).writeSummary(request('mine'));
    buffer.commit('b', 1);
    buffer.commit('a', 2);
    expect(buffer.finish().map((write) => write.text)).toEqual(['mine']);
    expect(execution.warnings).toEqual([
      '"Node a" also ran in the reply run, so its summary writes were not repeated in this run.',
    ]);
  });
  it('does not warn about a repeated node that wrote nothing', () => {
    const execution = log();
    const buffer = new SummaryRun({}, execution, { ids: new Set(['a']), nameOf: (id) => id });
    buffer.commit('a', 1);
    expect(execution.warnings).toEqual([]);
  });
});

describe('summary writes in a run', () => {
  const writer = (text: string) =>
    testType('summary-writer', {
      execute: async (ctx) => {
        ctx.writeSummary(request(text));
        return { value: text };
      },
      sink: true,
    });
  const base = (extra: ReturnType<typeof node>[]) =>
    graph(
      [node('input', 'chat-input'), node('output', 'chat-output'), ...extra],
      [edge('input', 'message', 'output', 'value')],
    );

  it('come back with the result, only for nodes that completed', async () => {
    register(writer('kept'));
    register(
      testType('failing-writer', {
        sink: true,
        execute: async (ctx) => {
          ctx.writeSummary(request('lost'));
          throw new Error('boom');
        },
      }),
    );
    const ok = await executeWorkflow(base([node('w', 'summary-writer')]), run);
    expect(ok.summaryWrites).toMatchObject([{ nodeId: 'w', text: 'kept', id: `${ok.execution.id}:w:1` }]);
    const failure = await executeWorkflow(base([node('w', 'summary-writer'), node('f', 'failing-writer')]), run).catch(
      (error) => error,
    );
    expect(failure).toBeInstanceOf(ExecutionFailure);
    expect(failure.summaryWrites.map((write: { text: string }) => write.text)).toEqual(['kept']);
  });
  it('are given nothing in a run without them', async () => {
    const result = await executeWorkflow(base([]), run);
    expect(result.summaryWrites).toEqual([]);
  });
  it('see the snapshot the caller passed, not their own writes', async () => {
    let seen: unknown;
    register(
      testType('summary-reader', {
        sink: true,
        execute: async (ctx) => {
          ctx.writeSummary(request('x'));
          seen = ctx.summaries;
          return {};
        },
      }),
    );
    const stored = {
      main: [{ id: 's', messageIds: ['m1'], fingerprint: 'f', text: 't', createdAt: '', executionId: 'e' }],
    };
    await executeWorkflow(base([node('r', 'summary-reader')]), { ...run, summaries: stored });
    expect(seen).toEqual(stored);
  });
  it('are not repeated in the after-reply run by a node the reply run ran too', async () => {
    register(writer('w'));
    register(
      testType('gated-writer', {
        sink: true,
        inputs: [
          { name: 'value', label: 'Value', dataType: 'any' },
          { name: 'when', label: 'When', dataType: 'any' },
        ],
        execute: async (ctx) => {
          ctx.writeSummary(request('consumer'));
          return {};
        },
      }),
    );
    // `w` is a reply sink that also feeds `consumer`, which waits for After Reply.
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('w', 'summary-writer'),
        node('after', 'after-reply'),
        node('consumer', 'gated-writer'),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('w', 'value', 'consumer', 'value'),
        edge('after', 'turn', 'consumer', 'when'),
      ],
    );
    const reply = await executeWorkflow(wf, run);
    expect(reply.summaryWrites.map((write) => write.nodeId)).toEqual(['w']);
    const post = await executeWorkflow(wf, postOptions);
    expect(post.execution.nodes.w?.status).toBe('completed');
    expect(post.summaryWrites.map((write) => write.nodeId)).toEqual(['consumer']);
    expect(post.execution.warnings).toEqual([
      '"summary-writer #1 (summary-writer)" also ran in the reply run, so its summary writes were not repeated in this run.',
    ]);
  });
});
