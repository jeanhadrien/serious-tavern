import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
export const chatInput: NodeDefinition = {
  type: 'chat-input', label: 'Chat Input', description: 'Incoming message and conversation history', category: 'Chat',
  inputs: [], outputs: [{ name: 'message', label: 'Message' }, { name: 'history', label: 'History' }],
  configSchema: z.object({}), defaultConfig: {},
  async execute({ trigger, history }) { return { message: trigger.message, history }; }
};
