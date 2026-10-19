import { z } from 'zod';
import { analyzeLinks, keyAccess } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
import { coerceValue } from '../../text.js';
import { itemsOf, locateCollection } from '../state-key.js';

/**
 * Drops from a list of messages the ones that an INTACT item of a collection key links to (the chat's messages those
 * items stand for), keeping the rest in their order. Items whose link is broken hide nothing, so their messages stay.
 * Whether an item is intact is judged against the whole chat, not against the input list. Nothing here is about
 * summaries: with a key of summaries it is "the history that no summary replaces".
 */
export const unlinkedMessages: NodeDefinition = {
  type: 'unlinked-messages',
  label: 'Unlinked Messages',
  description:
    'Leaves out the messages that an intact item of a state collection key links to, such as the messages a summary stands for. Messages of broken items stay.',
  category: 'History',
  inputs: [
    {
      name: 'messages',
      label: 'Messages',
      dataType: 'messages',
      required: true,
      description: 'The messages to filter, for example Memory with all messages',
    },
  ],
  outputs: [
    { name: 'messages', label: 'Messages', dataType: 'messages', description: 'The input without the linked messages' },
    {
      name: 'text',
      label: 'Text',
      dataType: 'text',
      description: 'The same messages as a transcript, one "role: content" line per message',
    },
  ],
  configSchema: z.object({
    definitionId: z.string().min(1, 'Select a state definition'),
    key: z.string().min(1, 'Select a key'),
  }),
  defaultConfig: { definitionId: '', key: '' },
  access: (config, { definition }) => {
    const definitionId = String(config.definitionId ?? '');
    return { reads: keyAccess(definitionId, String(config.key ?? ''), definition(definitionId)), writes: [] };
  },
  async execute(ctx) {
    // Unlike Next Chunk the ports are static: a missing or mistaken key is an error when the node runs.
    const found = await locateCollection(ctx.config, (id) => ctx.state.definition(id));
    const given = ctx.inputs.messages;
    if (!Array.isArray(given)) throw new Error('Unlinked Messages needs a list of messages on its Messages input');
    const covered = new Set(
      analyzeLinks(itemsOf(found, ctx.state.read), ctx.history)
        .filter(({ status }) => status === 'intact')
        .flatMap(({ link }) => link.ids),
    );
    const kept = given.filter((message) => !(typeof message?.id === 'string' && covered.has(message.id)));
    ctx.log(
      `${found.label}: ${given.length - kept.length} of ${given.length} messages are linked by intact items and left out.`,
    );
    return { messages: kept, text: coerceValue(kept, 'messages-to-text') };
  },
};
