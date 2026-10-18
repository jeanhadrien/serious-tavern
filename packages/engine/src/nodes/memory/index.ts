import { z } from 'zod';
import { composeHistory, SUMMARY_SET_PATTERN } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { partsToMessages, partsToText, transcript } from './render.js';

// A set name, or empty for no summaries.
const SET_PATTERN = new RegExp(`^$|${SUMMARY_SET_PATTERN.source}`);

export const memory: NodeDefinition = {
  type: 'memory',
  label: 'Memory',
  description: 'Recent conversation history, optionally with older history as summaries',
  category: 'Chat',
  inputs: [],
  outputs: [
    {
      name: 'history',
      label: 'History',
      dataType: 'any',
      description: 'Messages or formatted text, depending on the format setting',
    },
  ],
  configSchema: z.object({
    lastN: z
      .number()
      .int()
      .min(0)
      .default(10)
      .describe(
        'How many of the latest messages to include as they are. With a summary set, older messages that are not summarized yet are still sent in full',
      ),
    format: z.enum(['text', 'messages']).default('text'),
    summarySet: z
      .string()
      .trim()
      .regex(SET_PATTERN, 'Use 1-40 letters, digits, "_" or "-", or leave it empty')
      .default('')
      .describe(
        'A summary set (see Next Chunk). When set, older messages covered by a valid summary of the set are replaced by it; empty means no summaries. Older messages that are not summarized yet are still sent in full, so the history only shrinks as summaries are written: wire After Reply, Next Chunk, an LLM and Save Summary to write them',
      ),
  }),
  defaultConfig: { lastN: 10, format: 'text', summarySet: '' },
  async execute({ history, config, summaries, log }) {
    const lastN = Number(config.lastN);
    const messagesFormat = config.format === 'messages';
    const set = String(config.summarySet ?? '');
    if (!set) {
      const recent = lastN === 0 ? [] : history.slice(-lastN);
      return { history: messagesFormat ? recent : transcript(recent) };
    }
    const stored = Object.hasOwn(summaries, set) ? summaries[set]! : [];
    const { parts, unused } = composeHistory({ history, summaries: stored, lastN });
    const used = stored.length - unused;
    log(
      `Summary set "${set}": ${used} of ${stored.length} summaries used` +
        (unused
          ? `; ${unused} not used (a covered message changed, or it reaches into the ${lastN} raw messages).`
          : '.'),
    );
    return { history: messagesFormat ? partsToMessages(parts) : partsToText(parts) };
  },
};
