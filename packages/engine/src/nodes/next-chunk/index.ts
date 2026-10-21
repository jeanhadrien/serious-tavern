import { z } from 'zod';
import { planNextChunk, type PortDef } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { coerceValue } from '@st/shared/ports';
import { itemsOf, locateCollection } from '../state-key.js';

const outputs: PortDef[] = [
  { name: 'messages', label: 'Messages', dataType: 'messages', optional: true, description: 'The chunk as messages' },
  {
    name: 'text',
    label: 'Text',
    dataType: 'text',
    optional: true,
    description: 'The chunk as a transcript, one "role: content" line per message',
  },
  {
    name: 'link',
    label: 'Link',
    dataType: 'object',
    optional: true,
    description: "Which messages the chunk covers ({ ids, fingerprint }): connect it to State Write's Messages input",
  },
  {
    name: 'replaces',
    label: 'Replaces',
    dataType: 'text',
    optional: true,
    description:
      'The id of the broken item this chunk is redone for; absent for a new chunk. Wire it to a State Write remove if you want the old item gone',
  },
];

/**
 * Finds the next chunk of chat messages that a collection key does not cover yet: the first item of the key whose link
 * is broken (and not already replaced) is re-planned over its surviving messages, else the oldest run of `chunkSize`
 * messages outside the raw window that no intact item links to. One chunk per run; with nothing to do it outputs
 * nothing, so everything wired after it is skipped. Nothing here is about summaries: it finds messages a key doesn't
 * cover yet. The planning is the pure `planNextChunk` in shared.
 */
export const nextChunk: NodeDefinition = {
  type: 'next-chunk',
  label: 'Next Chunk',
  description:
    'Finds the next chunk of older chat messages that no intact item of a state collection key links to (or a broken item to redo). Outputs nothing when every message outside the raw window is covered.',
  category: 'History',
  inputs: [],
  outputs,
  configSchema: z.object({
    definitionId: z.string().min(1, 'Select a state definition'),
    key: z.string().min(1, 'Select a key'),
    chunkSize: z.number().int().min(2).default(20).describe('Messages per chunk, counted from the start of the chat'),
    rawWindow: z
      .number()
      .int()
      .min(0)
      .default(16)
      .describe(
        'How many of the newest messages are never summarized: a message stays raw until this many newer ones follow it',
      ),
  }),
  defaultConfig: { definitionId: '', key: '', chunkSize: 20, rawWindow: 16 },
  // The ports never change; resolving them checks the target, so an unset or mistaken key shows as "not set up".
  async resolvePorts(config, resources) {
    await locateCollection(config, (id) => resources.stateDefinitions?.get(id));
    return { inputs: [], outputs };
  },
  async execute(ctx) {
    const found = await locateCollection(ctx.config, (id) => ctx.state.definition(id));
    const { chunkSize, rawWindow } = ctx.config as { chunkSize: number; rawWindow: number };
    const decision = planNextChunk({
      history: ctx.history,
      items: itemsOf(found, ctx.state.read),
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
        ? `Next chunk: ${messages.length} messages that ${found.label} does not link yet.`
        : `Next chunk: an item of ${found.label} no longer matches the chat; ${messages.length} of its messages are left to redo.`,
    );
    return {
      messages: structuredClone(messages),
      text: coerceValue(messages, 'messages-to-text'),
      link: { ids: messageIds, fingerprint },
      ...(replaces === undefined ? {} : { replaces }),
    };
  },
};
