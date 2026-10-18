import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fingerprintMessages, type ChatMessage, type Summary } from '@st/shared';
import { executeWorkflow } from './executor.js';
import { memory } from './nodes/memory/index.js';
import { renderPreset } from './preset.js';
import { edge, graph, node, resourcesWith, runNode } from './test-collections.js';
import { run } from './test-post.js';

const chat = (count: number): ChatMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `text ${index + 1}`,
    createdAt: '',
    ...(index === 1 ? { name: 'Mira' } : {}),
  }));
const summaryOf = (history: ChatMessage[], first: number, last: number): Summary => {
  const covered = history.slice(first - 1, last);
  return {
    id: `s${first}`,
    messageIds: covered.map((m) => m.id),
    fingerprint: fingerprintMessages(covered),
    text: `summary ${first}-${last}`,
    createdAt: '',
    executionId: 'e0',
  };
};
const resources = resourcesWith();
const memoryOf = (config: Record<string, unknown>, history: ChatMessage[], summaries: Record<string, Summary[]> = {}) =>
  runNode(memory, config, { resources, history, summaries });

describe('Memory config', () => {
  it('has summarySet off by default', () => {
    expect(memory.configSchema.parse({})).toEqual({ lastN: 10, format: 'text', summarySet: '' });
    expect(memory.defaultConfig).toEqual({ lastN: 10, format: 'text', summarySet: '' });
  });
  it('keeps old configs working (no summarySet stored)', () => {
    expect(memory.configSchema.parse({ lastN: 3, format: 'messages' })).toEqual({
      lastN: 3,
      format: 'messages',
      summarySet: '',
    });
  });
  it.each(['main', ' main ', 'a-b_2', ''])('accepts the set %j', (summarySet) => {
    expect(memory.configSchema.safeParse({ summarySet }).success).toBe(true);
  });
  it.each(['two words', '-x', 'é', 'x'.repeat(41)])('rejects the set %j', (summarySet) => {
    expect(memory.configSchema.safeParse({ summarySet }).success).toBe(false);
  });
});

describe('Memory without a summary set is exactly as before', () => {
  const history = chat(6);
  const summaries = { main: [summaryOf(history, 1, 4)] };
  it.each([
    [{ lastN: 3, format: 'text' }, 'user: text 4'.replace('user', 'assistant') + '\nuser: text 5\nassistant: text 6'],
    [{ lastN: 0, format: 'text' }, ''],
    [{ lastN: 50, format: 'text' }, history.map((m) => `${m.role}: ${m.content}`).join('\n')],
  ])('text %j', async (config, expected) => {
    expect((await memoryOf(config, history, summaries)).output.history).toBe(expected);
  });
  it('messages', async () => {
    expect((await memoryOf({ lastN: 2, format: 'messages' }, history, summaries)).output.history).toEqual(
      history.slice(-2),
    );
    expect((await memoryOf({ lastN: 0, format: 'messages' }, history, summaries)).output.history).toEqual([]);
  });
  it('logs nothing', async () => {
    expect((await memoryOf({ lastN: 2 }, history, summaries)).logs).toEqual([]);
  });
});

describe('Memory with a summary set', () => {
  const history = chat(12);
  const stored = { main: [summaryOf(history, 1, 4), summaryOf(history, 5, 8)], other: [summaryOf(history, 1, 8)] };
  const output = async (config: Record<string, unknown>, h = history, s: Record<string, Summary[]> = stored) =>
    (await memoryOf({ summarySet: 'main', ...config }, h, s)).output.history;

  it('text: summaries as "Summary:" lines, then the last N raw', async () => {
    expect(await output({ lastN: 4, format: 'text' })).toBe(
      [
        'Summary: summary 1-4',
        'Summary: summary 5-8',
        'user: text 9',
        'assistant: text 10',
        'user: text 11',
        'assistant: text 12',
      ].join('\n'),
    );
  });
  it('messages: summaries as system messages, raw messages untouched', async () => {
    const result = (await output({ lastN: 4, format: 'messages' })) as unknown[];
    expect(result).toEqual([
      { role: 'system', content: '[Summary of earlier messages]\nsummary 1-4' },
      { role: 'system', content: '[Summary of earlier messages]\nsummary 5-8' },
      ...history.slice(8),
    ]);
    expect(result[2]).toBe(history[8]);
  });
  it('keeps names of raw messages and the other set separate', async () => {
    const result = (await output({ lastN: 4, format: 'messages', summarySet: 'other' })) as ChatMessage[];
    expect(result).toEqual([
      { role: 'system', content: '[Summary of earlier messages]\nsummary 1-8' },
      ...history.slice(8),
    ]);
    // A set with no summaries yet shows the whole history raw, until Next Chunk and Save Summary catch up.
    expect(await output({ lastN: 4, summarySet: 'nope' })).toBe(
      history.map((m) => `${m.role}: ${m.content}`).join('\n'),
    );
  });
  it('falls back to raw messages for an edited chunk and keeps the other', async () => {
    const edited = history.map((m) => (m.id === 'm3' ? { ...m, content: 'edited' } : m));
    const text = String(await output({ lastN: 4 }, edited));
    expect(text.split('\n').slice(0, 5)).toEqual([
      'user: text 1',
      'assistant: text 2',
      'user: edited',
      'assistant: text 4',
      'Summary: summary 5-8',
    ]);
  });
  it('falls back to raw messages for a chunk with a deleted message', async () => {
    const text = String(
      await output(
        { lastN: 4 },
        history.filter((m) => m.id !== 'm6'),
      ),
    );
    expect(text).toContain('Summary: summary 1-4\nuser: text 5\nuser: text 7');
  });
  it('does not use a summary that reaches into the last N messages', async () => {
    // The raw part is m7..m12, so summary 5-8 straddles it: m5 and m6 stay raw.
    const text = String(await output({ lastN: 6 }));
    expect(text.split('\n')).toEqual([
      'Summary: summary 1-4',
      ...history.slice(4).map((m) => `${m.role}: ${m.content}`),
    ]);
  });
  it('never shows a message twice', async () => {
    const overlapping = { main: [summaryOf(history, 1, 6), summaryOf(history, 5, 8)] };
    const lines = String(await output({ lastN: 4 }, history, overlapping)).split('\n');
    expect(lines).toEqual(['Summary: summary 1-6', 'user: text 7', 'assistant: text 8', ...lines.slice(3)]);
    expect(lines).toHaveLength(7);
  });
  it('lastN 0 keeps its meaning for the raw part: only older messages and summaries remain', async () => {
    expect(await output({ lastN: 0 })).toBe(
      ['Summary: summary 1-4', 'Summary: summary 5-8', ...history.slice(8).map((m) => `${m.role}: ${m.content}`)].join(
        '\n',
      ),
    );
  });
  it('is the plain raw history when nothing is stored', async () => {
    const result = await memoryOf({ summarySet: 'main', lastN: 4, format: 'messages' }, history, {});
    expect(result.output.history).toEqual(history);
    expect(result.logs).toEqual(['Summary set "main": 0 of 0 summaries used.']);
  });
  it('logs how many summaries it used and why others were not', async () => {
    const edited = history.map((m) => (m.id === 'm3' ? { ...m, content: 'edited' } : m));
    expect((await memoryOf({ summarySet: 'main', lastN: 4 }, edited, stored)).logs).toEqual([
      'Summary set "main": 1 of 2 summaries used; 1 not used (a covered message changed, or it reaches into the 4 raw messages).',
    ]);
  });
  it('the messages output goes through a preset message slot (system summaries included)', async () => {
    const value = (await output({ lastN: 4, format: 'messages' })) as unknown[];
    const rendered = renderPreset(
      {
        id: randomUUID(),
        name: 'p',
        inputs: [{ id: randomUUID(), key: 'history', dataType: 'messages' }],
        entries: [
          { id: randomUUID(), displayName: 'History', kind: 'slot', enabled: true, inputKey: 'history', role: 'user' },
        ],
        createdAt: '',
        updatedAt: '',
      },
      { inputs: { history: value }, templateContext: { trigger: { message: '', sessionId: '' } } },
    );
    expect(rendered.map((message) => message.role)).toEqual([
      'system',
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(rendered[0]?.content).toBe('[Summary of earlier messages]\nsummary 1-4');
  });
  it('runs in a workflow with the summaries the caller passes', async () => {
    const wf = graph(
      [
        node('input', 'chat-input'),
        node('mem', 'memory', { summarySet: 'main', lastN: 4 }),
        node('output', 'chat-output'),
      ],
      [edge('mem', 'history', 'output', 'value')],
    );
    const result = await executeWorkflow(wf, { ...run, history, summaries: stored });
    expect(String(result.replies[0]?.content).split('\n').slice(0, 2)).toEqual([
      'Summary: summary 1-4',
      'Summary: summary 5-8',
    ]);
  });
});
