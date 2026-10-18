import { z } from 'zod';
import { planNextChunk, summarySetNameSchema, type ChunkRef } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { transcript } from '../memory/render.js';

/**
 * Finds the next chunk of the chat's history to summarize, for one summary set: the first summary of the set whose
 * covered messages changed (re-planned over the messages that are left), else the oldest run of `chunkSize` messages
 * that is outside the raw window and not summarized yet. One chunk per run; with nothing to do it outputs nothing, so
 * everything wired after it is skipped. The planning itself is the pure `planNextChunk` in shared.
 */
export const nextChunk: NodeDefinition = {
  type: 'next-chunk',
  label: 'Next Chunk',
  description:
    'Finds the next chunk of older chat history that needs a summary (or a new one, after an edit or delete). Outputs nothing when every chunk outside the raw window is summarized.',
  category: 'History',
  inputs: [
    {
      name: 'after',
      label: 'After',
      dataType: 'any',
      description:
        'Nothing is read from it. Connect After Reply here to look for a chunk after the reply, so summarizing never delays it',
    },
  ],
  outputs: [
    {
      name: 'messages',
      label: 'Messages',
      dataType: 'messages',
      optional: true,
      description: 'The chunk as messages',
    },
    {
      name: 'text',
      label: 'Text',
      dataType: 'text',
      optional: true,
      description: 'The chunk as a transcript, one "role: content" line per message',
    },
    {
      name: 'chunk',
      label: 'Chunk',
      dataType: 'object',
      optional: true,
      description: 'Which messages the chunk covers: connect it to Save Summary',
    },
  ],
  configSchema: z.object({
    set: summarySetNameSchema.default('main').describe('The summary set this chunk belongs to'),
    chunkSize: z.number().int().min(2).default(20).describe('Messages per chunk, counted from the start of the chat'),
    rawWindow: z
      .number()
      .int()
      .min(0)
      .default(16)
      .describe('The most recent messages, never summarized. Keep it at least as big as Memory\'s "last N"'),
  }),
  defaultConfig: { set: 'main', chunkSize: 20, rawWindow: 16 },
  async execute(ctx) {
    const { set, chunkSize, rawWindow } = ctx.config as { set: string; chunkSize: number; rawWindow: number };
    const decision = planNextChunk({
      history: ctx.history,
      summaries: Object.hasOwn(ctx.summaries, set) ? ctx.summaries[set]! : [],
      chunkSize,
      rawWindow,
    });
    if (!decision.chunk) {
      ctx.log(decision.reason);
      return {};
    }
    const { messages, messageIds, fingerprint, replaces } = decision.chunk;
    ctx.log(
      replaces === undefined
        ? `Next chunk: ${messages.length} messages not summarized yet.`
        : `Next chunk: a summary of set "${set}" no longer matches the chat; ${messages.length} of its messages are left to summarize again.`,
    );
    const chunk: ChunkRef = { set, messageIds, fingerprint, ...(replaces === undefined ? {} : { replaces }) };
    return { messages: structuredClone(messages), text: transcript(messages), chunk };
  },
};
