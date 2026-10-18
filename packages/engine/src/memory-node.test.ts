import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@st/shared';
import { memory } from './nodes/memory/index.js';
import { resourcesWith, runNode } from './test-collections.js';

const history: ChatMessage[] = Array.from({ length: 6 }, (_, index) => ({
  id: `m${index + 1}`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `text ${index + 1}`,
  createdAt: '',
}));
const run = async (config: Record<string, unknown>) =>
  (await runNode(memory, memory.configSchema.parse(config), { resources: resourcesWith(), history })).output.history;
const ids = (value: unknown) => (value as ChatMessage[]).map((message) => message.id);

describe('Memory', () => {
  it('sends the last N messages, as text or as messages', async () => {
    expect(await run({ lastN: 2 })).toBe('user: text 5\nassistant: text 6');
    expect(ids(await run({ lastN: 2, format: 'messages' }))).toEqual(['m5', 'm6']);
  });

  it('sends everything when N is larger than the chat, and nothing for 0', async () => {
    expect(ids(await run({ lastN: 99, format: 'messages' }))).toHaveLength(6);
    expect(await run({ lastN: 0 })).toBe('');
    expect(await run({ lastN: 0, format: 'messages' })).toEqual([]);
  });

  it('behaves as before for configs saved without `all`', () => {
    expect(memory.configSchema.parse({ lastN: 4, format: 'messages' })).toEqual({
      lastN: 4,
      format: 'messages',
      all: false,
    });
    expect(memory.configSchema.parse({})).toEqual({ lastN: 10, format: 'text', all: false });
    expect(memory.defaultConfig).toEqual({ lastN: 10, format: 'text', all: false });
  });

  describe('all', () => {
    it('sends the whole history, ignoring N, in both formats', async () => {
      expect(ids(await run({ all: true, lastN: 2, format: 'messages' }))).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
      expect(await run({ all: true, lastN: 1 })).toBe(history.map((m) => `${m.role}: ${m.content}`).join('\n'));
    });

    it('also overrides N = 0', async () => {
      expect(ids(await run({ all: true, lastN: 0, format: 'messages' }))).toHaveLength(6);
    });

    it('sends nothing for an empty chat', async () => {
      const empty = await runNode(
        memory,
        { all: true, format: 'messages' },
        { resources: resourcesWith(), history: [] },
      );
      expect(empty.output.history).toEqual([]);
    });

    it('off means off', async () => {
      expect(ids(await run({ all: false, lastN: 1, format: 'messages' }))).toEqual(['m6']);
    });
  });
});
