import { z } from 'zod';
import { cardTemplates, noAccess } from '@st/shared';
import type { NodeDefinition } from '../../types.js';

export const character: NodeDefinition = {
  type: 'character',
  label: 'Character',
  description: 'Use the session character or a specific character card',
  category: 'Chat',
  inputs: [],
  outputs: [{ name: 'character', label: 'Character', dataType: 'character' }],
  configSchema: z
    .object({
      source: z.enum(['session', 'card']).default('session'),
      characterId: z.string().default(''),
    })
    .refine((config) => config.source !== 'card' || !!config.characterId, {
      message: 'Select a character card',
      path: ['characterId'],
    }),
  defaultConfig: { source: 'session', characterId: '' },
  async resolvePorts(config, resources) {
    if (config.source === 'card' && !(await resources.characters?.get(String(config.characterId))))
      throw new Error(`Character ${config.characterId || '(none)'} not found`);
    return { inputs: character.inputs, outputs: character.outputs };
  },
  access: () => noAccess(),
  // A card's fields are templates too, expanded wherever the card is rendered.
  async resourceTemplates(config, resources) {
    return config.source === 'card'
      ? cardTemplates(await resources.characters?.get(String(config.characterId ?? '')), 'character')
      : [];
  },
  async execute(ctx) {
    const card =
      ctx.config.source === 'card'
        ? await ctx.resources.characters?.get(String(ctx.config.characterId))
        : ctx.character;
    if (!card)
      throw new Error(
        ctx.config.source === 'card'
          ? `Character ${ctx.config.characterId} not found`
          : 'No session character selected. Select a character for this chat.',
      );
    return { character: card };
  },
};
