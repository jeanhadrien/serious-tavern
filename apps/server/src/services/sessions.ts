import {
  describeSettingValue,
  settingValueProblem,
  usableSettings,
  workflowSettings,
  type ApiParsedBody,
  type ApiResponse,
  type ChatSettingIssue,
  type Workflow,
} from '@st/shared';
import type { AppContext } from '../context.js';
import { HttpError, notFound, requireEntity } from '../errors.js';

/**
 * Applies a session metadata patch under the session lock. It never advances `updatedAt`: only
 * sending a message does (recency order). Chat settings are merged, see `mergeSettings`.
 */
export async function updateSession(
  { workflows, characters, personas, sessions }: AppContext,
  id: string,
  body: ApiParsedBody<'updateSession'>,
): Promise<ApiResponse<'updateSession'>> {
  const { settings, ...rest } = body;
  const session = await sessions.update(id, async (current) => {
    const workflow = rest.workflowId ? await requireEntity(workflows, rest.workflowId, 'Workflow') : undefined;
    if (rest.characterId) await requireEntity(characters, rest.characterId, 'Character');
    if (rest.personaId) await requireEntity(personas, rest.personaId, 'Persona');
    // Values are checked against the workflow the chat uses after this patch. Checked before any change.
    const nextSettings = settings
      ? mergeSettings(
          current.settings,
          settings,
          workflow ?? (await requireEntity(workflows, current.workflowId, 'Workflow')),
        )
      : undefined;
    if (rest.characterId === null) delete current.characterId;
    if (rest.personaId === null) delete current.personaId;
    Object.assign(current, Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null)));
    if (nextSettings) current.settings = nextSettings;
    return current;
  });
  if (!session) throw notFound('Session');
  return session;
}

/**
 * Merges a settings patch into the stored values: `null` removes a key (any key, declared or not), any
 * other value must fit a setting the workflow declares. One bad entry rejects the whole patch
 * (`400 CHAT_SETTING_INVALID`). Stored keys the patch doesn't name are kept as they are, declared or not.
 */
export function mergeSettings(
  stored: Readonly<Record<string, unknown>> | undefined,
  patch: Readonly<Record<string, unknown>>,
  workflow: Workflow,
): Record<string, unknown> {
  const declarations = new Map(usableSettings(workflowSettings(workflow)).map((setting) => [setting.key, setting]));
  const next: Record<string, unknown> = { ...stored };
  const issues: ChatSettingIssue[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
      continue;
    }
    const setting = declarations.get(key);
    const problem = setting && settingValueProblem(setting, value);
    if (!setting) issues.push({ key, message: `Workflow "${workflow.name}" has no chat setting "${key}".` });
    else if (problem)
      issues.push({ key, message: `Chat setting "${key}": ${describeSettingValue(value)} ${problem}.` });
    else next[key] = value;
  }
  if (issues.length)
    throw new HttpError(400, 'CHAT_SETTING_INVALID', issues.map((issue) => issue.message).join(' '), { issues });
  return next;
}
