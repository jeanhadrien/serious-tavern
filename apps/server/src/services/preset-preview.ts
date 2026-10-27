import type { ApiParsedBody, ApiResponse } from '@st/shared';
import {
  activeMessages,
  emptyStateSnapshot,
  presetWarnings,
  resolveChatSettings,
  settingsCatalog,
  snippetTexts,
  stateTemplateValues,
  listedSettings,
  replyWorkflows,
  type Session,
  type Workflow,
} from '@st/shared';
import { renderPreset } from '@st/engine';
import type { AppContext } from '../context.js';
import { errorMessage, HttpError, notFound } from '../errors.js';
import { historyMessages } from './settle-turn.js';
import { foldSession, listDefinitions } from './story-state.js';

// The workflows of the chat's reply list, in order (one that no longer exists declares nothing).
async function listedWorkflows(workflows: AppContext['workflows'], session: Session): Promise<Workflow[]> {
  const found = await Promise.all(replyWorkflows(session).map((entry) => workflows.get(entry.workflowId)));
  return found.flatMap((workflow) => (workflow ? [workflow] : []));
}

export async function previewPreset(
  { sessions, workflows, characters, personas, stateDefinitions, snippets }: AppContext,
  { preset, inputs = {}, sessionId }: ApiParsedBody<'previewPreset'>,
): Promise<ApiResponse<'previewPreset'>> {
  const session = sessionId ? await sessions.get(sessionId) : undefined;
  if (sessionId && !session) throw notFound('Session');
  const character = session?.characterId ? await characters.get(session.characterId) : undefined;
  const persona = session?.personaId ? await personas.get(session.personaId) : undefined;
  // With a session, what its next turn would see; without one, what a new chat would see: the default of
  // every key any workflow declares (its first declaration, as in the preset editor's hints).
  const declarations = session
    ? listedSettings(await listedWorkflows(workflows, session))
    : settingsCatalog(await workflows.list());
  const settings = resolveChatSettings(declarations, session?.settings).values;
  // The story state the session's next turn would see; a new chat sees every key at its default, turn 1. The history
  // the next turn would get gives linked items their `link` (what `linked` and `{{link.status}}` read).
  const definitions = await listDefinitions(stateDefinitions);
  const state = session
    ? foldSession(definitions, session, historyMessages(session.messages)).snapshot
    : emptyStateSnapshot(definitions);
  const stored = await snippets.list();
  const values: Record<string, unknown> = { ...inputs };
  const sample = [
    { role: 'user', content: 'Hello!' },
    { role: 'assistant', content: 'Hi! How can I help?' },
  ];
  for (const input of preset.inputs) {
    if (input.dataType === 'messages') {
      if (!Object.hasOwn(inputs, input.key)) values[input.key] = session ? activeMessages(session.messages) : sample;
    } else values[input.key] ??= `<${input.key}>`;
  }
  try {
    return {
      messages: renderPreset(preset, {
        inputs: values,
        templateContext: {
          trigger: { message: 'Sample message', sessionId: sessionId ?? 'sample-session', turn: state.turn },
          history: session && activeMessages(session.messages),
          character,
          persona,
          settings,
          state: { values: stateTemplateValues(state) },
          snippets: snippetTexts(stored),
        },
      }),
      warnings: presetWarnings(preset, { snippetNames: stored.map((snippet) => snippet.name) }),
    };
  } catch (error) {
    throw new HttpError(400, 'PRESET_PREVIEW_INVALID', errorMessage(error));
  }
}
