import { z } from 'zod';
import { noAccess } from '@st/shared';
import type { NodeDefinition } from '../../types.js';
export const chatInput: NodeDefinition = {
  type: 'chat-input',
  label: 'Chat Input',
  description: 'Incoming message, conversation history, and what the workflows above this one did in this turn',
  category: 'Chat',
  inputs: [],
  outputs: [
    { name: 'message', label: 'Message', dataType: 'text', description: 'The incoming chat message' },
    { name: 'history', label: 'History', dataType: 'messages', description: 'Earlier messages in this session' },
    {
      name: 'replies',
      label: 'Replies',
      dataType: 'messages',
      description:
        'The replies the workflows above this one saved in this turn, in chat order (empty for the first workflow)',
    },
    {
      name: 'turn',
      label: 'Turn',
      dataType: 'number',
      description: "The turn's number (1 for the first reply), the same as {{trigger.turn}}",
      // A run without story state (the server always gives one) has no turn number.
      optional: true,
    },
  ],
  configSchema: z.object({}),
  defaultConfig: {},
  // `history` and `replies` are the chat as the runs above this one left it.
  access: (_config, { connected }) =>
    connected.has('history') || connected.has('replies') ? { reads: [{ kind: 'messages' }], writes: [] } : noAccess(),
  async execute({ trigger, history, replies }) {
    return {
      message: trigger.message,
      history,
      replies,
      ...(trigger.turn === undefined ? {} : { turn: trigger.turn }),
    };
  },
};
