import type { ApiParsedBody, ApiResponse } from '@st/shared';
import { presetWarnings } from '@st/shared';
import { renderPreset } from '@st/engine';
import type { AppContext } from '../context.js';
import { errorMessage, HttpError, notFound } from '../errors.js';

export async function previewPreset(
  { sessions, characters, personas }: AppContext,
  { preset, inputs = {}, sessionId }: ApiParsedBody<'previewPreset'>,
): Promise<ApiResponse<'previewPreset'>> {
  const session = sessionId ? await sessions.get(sessionId) : undefined;
  if (sessionId && !session) throw notFound('Session');
  const character = session?.characterId ? await characters.get(session.characterId) : undefined;
  const persona = session?.personaId ? await personas.get(session.personaId) : undefined;
  const values: Record<string, unknown> = { ...inputs };
  const sample = [
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: 'Hi! How can I help?' },
  ];
  for (const input of preset.inputs) {
    if (input.dataType === 'messages') values[input.key] = session ? session.messages : sample;
    else values[input.key] ??= `<${input.key}>`;
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
        },
      }),
      warnings: presetWarnings(preset),
    };
  } catch (error) {
    throw new HttpError(400, 'PRESET_PREVIEW_INVALID', errorMessage(error));
  }
}
