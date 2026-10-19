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

/**
 * The entries of the Default preset that come before the chat history: system prompt, character, personality,
 * scenario, persona and example dialogue. The example narrators are Default plus what each example adds, so a
 * character card behaves the same in them.
 */
export const narratorIntro = (): Entry[] => [
  message(
    'main-prompt',
    'Main prompt',
    'Write a natural, in-character reply in this fictional chat.\n{{character.system_prompt}}',
  ),
  message('character-description', 'Character description', '{{character.description}}'),
  message('personality', 'Personality', '{{character.personality}}'),
  message('scenario', 'Scenario', '{{character.scenario}}'),
  message('persona', 'Persona', '{{persona.description}}'),
  message('example-dialogue', 'Example dialogue', '{{character.mes_example}}'),
];

/** The Default preset's entry that comes after the chat history and before the user's message. */
export const narratorOutro = (): Entry[] => [
  message('post-history', 'Post-history instructions', '{{character.post_history_instructions}}'),
];
