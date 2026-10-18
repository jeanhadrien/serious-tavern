import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';

export const AFTER_REPLY_TYPE = 'after-reply';

/**
 * Marks work that runs after the reply: every sink that depends on this node (a State Write)
 * runs in a second run once the turn has settled (see `parts.ts`). Its outputs only have values in that run.
 */
export const afterReply: NodeDefinition = {
  type: AFTER_REPLY_TYPE,
  label: 'After Reply',
  description:
    "Marks work that runs after the reply is saved, in a second run that can't delay or break the reply. Gives the turn's replies and its number. Use these outputs rather than wiring the reply's own nodes into after-reply work: a node needed by both parts runs twice.",
  category: 'Chat',
  inputs: [],
  outputs: [
    { name: 'replies', label: 'Replies', dataType: 'messages', description: "The turn's saved assistant messages" },
    { name: 'text', label: 'Text', dataType: 'text', description: 'Their contents joined by a blank line' },
    { name: 'turn', label: 'Turn', dataType: 'number', description: "The turn's number (1 for the first reply)" },
  ],
  configSchema: z.object({}),
  defaultConfig: {},
  async execute(ctx) {
    const reply = ctx.afterReply;
    if (!reply) throw new Error('After Reply only has values in the after-reply run.');
    return { replies: structuredClone(reply.replies), text: reply.text, turn: reply.turn };
  },
};
