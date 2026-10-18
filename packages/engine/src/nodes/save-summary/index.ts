import { z } from 'zod';
import { chunkRefSchema } from '@st/shared';
import type { NodeDefinition } from '../../types.js';

/**
 * Stores a summary of a chunk (from Next Chunk). It is a sink, so it runs every turn once its inputs are ready. The
 * summary is buffered and committed when the run settles, only if the chunk's messages are still exactly as Next
 * Chunk saw them; otherwise it is dropped with a warning in the execution log.
 */
export const saveSummary: NodeDefinition = {
  type: 'save-summary',
  label: 'Save Summary',
  description:
    "Stores a summary text for a chunk from Next Chunk, so Memory can use it in place of those messages. It is dropped, with a warning, if the chunk's messages changed meanwhile.",
  category: 'History',
  sink: true,
  inputs: [
    {
      name: 'chunk',
      label: 'Chunk',
      dataType: 'object',
      required: true,
      description: "Next Chunk's chunk output: which messages are summarized",
    },
    {
      name: 'text',
      label: 'Text',
      dataType: 'text',
      required: true,
      description: 'The summary. Empty text is an error: nothing is stored',
    },
  ],
  outputs: [{ name: 'summary', label: 'Summary', dataType: 'object', description: 'The summary as it will be stored' }],
  configSchema: z.object({}),
  defaultConfig: {},
  async execute(ctx) {
    const parsed = chunkRefSchema.safeParse(ctx.inputs.chunk);
    if (!parsed.success) throw new Error("Save Summary needs Next Chunk's chunk output on its Chunk input.");
    const text = String(ctx.inputs.text ?? '').trim();
    if (!text) throw new Error('The summary text is empty, so nothing was saved.');
    const { set, messageIds, fingerprint, replaces } = parsed.data;
    const { id } = ctx.writeSummary({
      set,
      messageIds,
      fingerprint,
      text,
      ...(replaces === undefined ? {} : { replaces }),
    });
    return { summary: { id, set, messageIds, fingerprint, text } };
  },
};
