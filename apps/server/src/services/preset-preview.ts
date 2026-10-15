import type { ApiParsedBody, ApiResponse } from '@st/shared';
import { presetWarnings, resolveChatSettings, workflowSettings } from '@st/shared';
import { renderPreset } from '@st/engine';
import type { AppContext } from '../context.js';
import { errorMessage, HttpError, notFound } from '../errors.js';

export async function previewPreset(
  { sessions, workflows, characters, personas }: AppContext,
  { preset, inputs = {}, sessionId }: ApiParsedBody<'previewPreset'>,
): Promise<ApiResponse<'previewPreset'>> {
  const session = sessionId ? await sessions.get(sessionId) : undefined;
  if (sessionId && !session) throw notFound('Session');
  const character = session?.characterId ? await characters.get(session.characterId) : undefined;
  const persona = session?.personaId ? await personas.get(session.personaId) : undefined;
  // With a session, what its next turn would see; without one there are no declarations, so `{}`.
  const workflow = session ? await workflows.get(session.workflowId) : undefined;
  const settings = session ? resolveChatSettings(workflowSettings(workflow ?? {}), session.settings).values : {};
  const values: Record<string, unknown> = { ...inputs };
  const sample = [
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: 'Hi! How can I help?' },
  ];
  for (const input of preset.inputs) {
    if (input.dataType === 'messages') {
      if (!Object.hasOwn(inputs, input.key)) values[input.key] = session ? session.messages : sample;
    } else values[input.key] ??= `<${input.key}>`;
  }
  try {
    return {
      messages: renderPreset(preset, {
        inputs: values,
        templateContext: {
          trigger: { message: 'Sample message', sessionId: sessionId ?? 'sample-session' },
          history: session?.messages,
          character,
          persona,
          settings,
        },
      }),
      warnings: presetWarnings(preset),
    };
  } catch (error) {
    throw new HttpError(400, 'PRESET_PREVIEW_INVALID', errorMessage(error));
  }
}
