import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintMessages, type ChatMessage, type Summary } from '@st/shared';
import { executeWorkflow } from './executor.js';
import { nextChunk } from './nodes/next-chunk/index.js';
import { saveSummary } from './nodes/save-summary/index.js';
import { registry } from './registry.js';
import { edge, graph, node, resourcesWith, runNode } from './test-collections.js';
import { postOptions, register, testType, unregister } from './test-post.js';

afterEach(unregister);

const chat = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `text ${index + 1}`,
    createdAt: '',
  }));
const summaryOf = (history: ChatMessage[], first: number, last: number, id = `s${first}`): Summary => {
  const covered = history.slice(first - 1, last);
  return {
    id,
    messageIds: covered.map((m) => m.id),
    fingerprint: fingerprintMessages(covered),
    text: `summary ${first}-${last}`,
    createdAt: '',
    executionId: 'e0',
  };
};
const resources = resourcesWith();
const next = (
  history: ChatMessage[],
  config: Record<string, unknown> = {},
  summaries: Record<string, Summary[]> = {},
) => runNode(nextChunk, { chunkSize: 4, rawWindow: 3, ...config }, { resources, history, summaries });

describe('Next Chunk config', () => {
  it('fills the defaults', () => {
    expect(nextChunk.configSchema.parse({})).toEqual({ set: 'main', chunkSize: 20, rawWindow: 16 });
    expect(nextChunk.defaultConfig).toEqual({ set: 'main', chunkSize: 20, rawWindow: 16 });
  });
  it.each<[string, Record<string, unknown>]>([
    ['a chunk of 1', { chunkSize: 1 }],
    ['a fractional chunk size', { chunkSize: 2.5 }],
    ['a negative raw window', { rawWindow: -1 }],
    ['a set name with spaces', { set: 'my set' }],
    ['an empty set name', { set: '' }],
  ])('rejects %s', (_, config) => {
    expect(nextChunk.configSchema.safeParse(config).success).toBe(false);
  });
  it('accepts the smallest values', () => {
    expect(nextChunk.configSchema.safeParse({ chunkSize: 2, rawWindow: 0, set: 'x' }).success).toBe(true);
  });
  it('is registered in the History category, with optional outputs', () => {
    expect(registry.get('next-chunk')).toBe(nextChunk);
    expect(nextChunk.category).toBe('History');
    expect(nextChunk.outputs.every((port) => port.optional)).toBe(true);
  });
});

describe('Next Chunk', () => {
  it('outputs the oldest chunk as messages, text and a chunk reference', async () => {
    const history = chat(10);
    const { output, logs } = await next(history);
    const covered = history.slice(0, 4);
    expect(output.messages).toEqual(covered);
    expect(output.text).toBe('user: text 1\nassistant: text 2\nuser: text 3\nassistant: text 4');
    expect(output.chunk).toEqual({
      set: 'main',
      messageIds: ['m1', 'm2', 'm3', 'm4'],
      fingerprint: fingerprintMessages(covered),
    });
    expect(logs).toEqual(['Next chunk: 4 messages not summarized yet.']);
  });
  it("continues after the set's summaries and ignores other sets", async () => {
    const history = chat(12);
    const stored = { main: [summaryOf(history, 1, 4)], other: [summaryOf(history, 5, 8)] };
    expect((await next(history, {}, stored)).output.chunk).toMatchObject({ messageIds: ['m5', 'm6', 'm7', 'm8'] });
    expect((await next(history, { set: 'other' }, stored)).output.chunk).toMatchObject({
      messageIds: ['m1', 'm2', 'm3', 'm4'],
    });
  });
  it.each<[string, number, string]>([
    ['an empty chat', 0, 'Nothing to summarize: the chat has 0 messages, all within the last 3 kept raw.'],
    [
      'a short chat',
      5,
      'Nothing to summarize yet: 2 messages outside the last 3 are not summarized, and a chunk needs 4.',
    ],
  ])('outputs nothing and logs why for %s', async (_, count, reason) => {
    const { output, logs } = await next(chat(count));
    expect(output).toEqual({});
    expect(logs).toEqual([reason]);
  });
  it('re-plans a summary whose message was edited, over the same messages', async () => {
    const history = chat(12);
    const old = summaryOf(history, 1, 4);
    const edited = history.map((m) => (m.id === 'm3' ? { ...m, content: 'changed' } : m));
    const { output, logs } = await next(edited, {}, { main: [old] });
    expect(output.chunk).toEqual({
      set: 'main',
      messageIds: ['m1', 'm2', 'm3', 'm4'],
      fingerprint: fingerprintMessages(edited.slice(0, 4)),
      replaces: old.id,
    });
    expect(logs[0]).toBe(
      'Next chunk: a summary of set "main" no longer matches the chat; 4 of its messages are left to summarize again.',
    );
  });
  it('re-plans over the surviving messages after a delete', async () => {
    const history = chat(12);
    const old = summaryOf(history, 1, 4);
    const rest = history.filter((m) => m.id !== 'm2');
    expect((await next(rest, {}, { main: [old] })).output.chunk).toMatchObject({
      messageIds: ['m1', 'm3', 'm4'],
      replaces: old.id,
    });
  });
  it("does not hand out the nodes' own history objects", async () => {
    const history = chat(10);
    const { output } = await next(history);
    expect((output.messages as ChatMessage[])[0]).not.toBe(history[0]);
  });
});

describe('Save Summary', () => {
  const chunk = { set: 'main', messageIds: ['m1', 'm2'], fingerprint: 'abc' };
  const save = (inputs: Record<string, unknown>) => runNode(saveSummary, {}, { resources, inputs });

  it('is a sink with a required chunk and text', () => {
    expect(saveSummary.sink).toBe(true);
    expect(saveSummary.category).toBe('History');
    expect(saveSummary.inputs.map((port) => [port.name, port.required])).toEqual([
      ['chunk', true],
      ['text', true],
    ]);
  });
  it('buffers the write and passes the summary on', async () => {
    const { output, summaryWrites } = await save({ chunk, text: '  The party met Borin.  ' });
    expect(summaryWrites).toEqual([{ ...chunk, text: 'The party met Borin.' }]);
    expect(output).toEqual({ summary: { id: 's1', ...chunk, text: 'The party met Borin.' } });
  });
  it('carries replaces from the chunk', async () => {
    const { summaryWrites } = await save({ chunk: { ...chunk, replaces: 'old' }, text: 't' });
    expect(summaryWrites).toEqual([{ ...chunk, text: 't', replaces: 'old' }]);
  });
  it.each<[string, Record<string, unknown>, string]>([
    ['empty text', { chunk, text: '' }, 'The summary text is empty, so nothing was saved.'],
    ['blank text', { chunk, text: ' \n ' }, 'The summary text is empty, so nothing was saved.'],
    ['no text', { chunk }, 'The summary text is empty, so nothing was saved.'],
    ['no chunk', { text: 't' }, "Save Summary needs Next Chunk's chunk output on its Chunk input."],
    [
      'a chunk of the wrong shape',
      { chunk: { set: 'main' }, text: 't' },
      "Save Summary needs Next Chunk's chunk output on its Chunk input.",
    ],
    [
      'a chunk with a bad set',
      { chunk: { ...chunk, set: 'a b' }, text: 't' },
      "Save Summary needs Next Chunk's chunk output on its Chunk input.",
    ],
    [
      'a chunk of nothing',
      { chunk: { ...chunk, messageIds: [] }, text: 't' },
      "Save Summary needs Next Chunk's chunk output on its Chunk input.",
    ],
  ])('fails on %s and stores nothing', async (_, inputs, message) => {
    await expect(save(inputs)).rejects.toThrow(message);
  });
});

describe('Next Chunk, an LLM stand-in and Save Summary in the after-reply run', () => {
  const summarize = testType('summarizer', {
    execute: async (ctx) => ({ value: `Summary of: ${String(ctx.inputs.value).split('\n').length} lines` }),
  });
  const workflow = () =>
    graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('after', 'after-reply'),
        node('next', 'next-chunk', { chunkSize: 4, rawWindow: 3 }),
        node('llm', 'summarizer'),
        node('save', 'save-summary'),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('after', 'turn', 'next', 'after'),
        edge('next', 'text', 'llm', 'value'),
        edge('next', 'chunk', 'save', 'chunk'),
        edge('llm', 'value', 'save', 'text'),
      ],
    );

  it('writes the summary of the next chunk', async () => {
    register(summarize);
    const history = chat(10);
    const result = await executeWorkflow(workflow(), { ...postOptions, history });
    expect(result.summaryWrites).toEqual([
      {
        id: `${result.execution.id}:save:1`,
        nodeId: 'save',
        set: 'main',
        messageIds: ['m1', 'm2', 'm3', 'm4'],
        fingerprint: fingerprintMessages(history.slice(0, 4)),
        text: 'Summary of: 4 lines',
      },
    ]);
  });
  it('skips the branch when there is nothing to summarize', async () => {
    register(summarize);
    const result = await executeWorkflow(workflow(), { ...postOptions, history: chat(5) });
    expect(result.summaryWrites).toEqual([]);
    expect(['next', 'llm', 'save'].map((id) => result.execution.nodes[id]?.status)).toEqual([
      'completed',
      'skipped',
      'skipped',
    ]);
    expect(result.execution.nodes.next?.logs?.[0]).toContain('Nothing to summarize yet');
  });
  it('does nothing in the reply run: the whole branch runs after the reply', async () => {
    register(summarize);
    const result = await executeWorkflow(workflow(), { ...postOptions, part: 'reply', history: chat(10) });
    expect(result.summaryWrites).toEqual([]);
    expect(result.execution.nodes.save?.status).toBe('skipped');
  });
  it('can run in the reply part when no After Reply is wired in', async () => {
    register(summarize);
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('output', 'chat-output'),
        node('next', 'next-chunk', { chunkSize: 4, rawWindow: 3 }),
        node('llm', 'summarizer'),
        node('save', 'save-summary'),
      ],
      [
        edge('input', 'message', 'output', 'value'),
        edge('next', 'text', 'llm', 'value'),
        edge('next', 'chunk', 'save', 'chunk'),
        edge('llm', 'value', 'save', 'text'),
      ],
    );
    const result = await executeWorkflow(wf, {
      ...postOptions,
      part: 'reply',
      afterReply: undefined,
      history: chat(10),
    });
    expect(result.summaryWrites.map((write) => write.nodeId)).toEqual(['save']);
  });
  it('an empty summary from the model fails the node and stores nothing', async () => {
    register(testType('summarizer', { execute: async () => ({ value: '   ' }) }));
    await expect(executeWorkflow(workflow(), { ...postOptions, history: chat(10) })).rejects.toMatchObject({
      nodeId: 'save',
      summaryWrites: [],
    });
  });
});
