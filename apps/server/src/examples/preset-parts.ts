import type { Preset } from '@st/shared';

type Entry = Preset['entries'][number];

/** An ordered message entry of the example presets (a template; blank renders are dropped). */
export const message = (
  id: string,
  displayName: string,
  content: string,
  role: 'system' | 'user' = 'system',
): Entry => ({ id, displayName, enabled: true, kind: 'message', role, content, placement: { mode: 'ordered' } });

/** A slot entry that puts a preset input (the chat history, the user's message) into the prompt. */
export const slot = (id: string, displayName: string, inputKey: string): Entry => ({
  id,
  displayName,
  enabled: true,
  kind: 'slot',
  inputKey,
  role: 'user',
});

/** The system prompt, character and persona entries every example narrator starts with. */
export const narratorIntro = (): Entry[] => [
  message(
    'main-prompt',
    'Main prompt',
    'Write a natural, in-character reply in this fictional chat.\n{{character.system_prompt}}',
  ),
  message('character-description', 'Character description', '{{character.description}}'),
  message('persona', 'Persona', '{{persona.description}}'),
];
