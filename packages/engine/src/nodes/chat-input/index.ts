import { z } from 'zod';
import type { NodeDefinition } from '../../types.js';
export const chatInput: NodeDefinition = {
  type: 'chat-input', label: 'Chat Input', description: 'Incoming message and conversation history', category: 'Chat',
  inputs: [], outputs: [
    { name: 'message', label: 'Message', dataType: 'text', description: 'The incoming chat message' },
    { name: 'history', label: 'History', dataType: 'messages', description: 'Earlier messages in this session' }
  ],
  configSchema: z.object({}), defaultConfig: {},
  async execute({ trigger, history }) { return { message: trigger.message, history }; }
};
