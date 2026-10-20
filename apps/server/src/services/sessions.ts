import { randomUUID } from 'node:crypto';
import {
  describeSettingValue,
  listedSettings,
  replyWorkflows,
  settingValueProblem,
  type ApiParsedBody,
  type ApiResponse,
  type ChatSettingIssue,
  type ReplyEntry,
  type Session,
  type Workflow,
} from '@st/shared';
import { now, type AppContext } from '../context.js';
import { HttpError, notFound, requireEntity } from '../errors.js';

/** `400 TRIGGERS_INVALID` for a reply list that cannot be stored: empty, or listing a workflow twice. */
function checkedReplyList(list: readonly ReplyEntry[]): ReplyEntry[] {
  if (!list.length) throw new HttpError(400, 'TRIGGERS_INVALID', 'The reply list needs at least one workflow');
  const seen = new Set<string>();
  for (const { workflowId } of list) {
    if (seen.has(workflowId))
      throw new HttpError(400, 'TRIGGERS_INVALID', 'A workflow can be in the reply list only once', { workflowId });
    seen.add(workflowId);
  }
  return [...list];
}

/** `session` with its reply list written: `triggers` (keeping what else it holds) and `workflowId`, which mirrors the first entry. */
function withReplyList(session: Session, reply: ReplyEntry[]) {
  session.triggers = { ...session.triggers, reply };
  session.workflowId = reply[0]!.workflowId;
}

/**
 * Creates a chat on one workflow (`workflowId`: the stored chat keeps its legacy shape, whose reply list is that
 * workflow alone) or on a reply list (`triggers`, stored with `workflowId` mirroring its first entry).
 */
export async function createSession(
  { workflows, characters, personas, sessions }: AppContext,
  body: ApiParsedBody<'createSession'>,
): Promise<ApiResponse<'createSession'>> {
  const list = body.triggers ? checkedReplyList(body.triggers.reply) : undefined;
  const workflowId = list ? list[0]!.workflowId : body.workflowId!;
  for (const id of list ? list.map((entry) => entry.workflowId) : [workflowId])
    await requireEntity(workflows, id, 'Workflow');
  if (body.characterId) await requireEntity(characters, body.characterId, 'Character');
  if (body.personaId) await requireEntity(personas, body.personaId, 'Persona');
  const date = now();
  const session: Session = {
    id: randomUUID(),
    title: body.title ?? 'New chat',
    workflowId,
    ...(list ? { triggers: { reply: list } } : {}),
    characterId: body.characterId,
    personaId: body.personaId,
    settings: {},
    state: { turns: [] },
    messages: [],
    createdAt: date,
    updatedAt: date,
  };
  await sessions.save(session);
  return session;
}

/**
 * Applies a session metadata patch under the session lock. It never advances `updatedAt`: only
 * sending a message does (recency order). Chat settings are merged, see `mergeSettings`. The reply list is a whole
 * replace (`triggers`, or the legacy `workflowId` for a list of that workflow alone); it applies from the next turn.
 */
export async function updateSession(
  { workflows, characters, personas, sessions }: AppContext,
  id: string,
  body: ApiParsedBody<'updateSession'>,
): Promise<ApiResponse<'updateSession'>> {
  const { settings, triggers, workflowId, ...rest } = body;
  if (triggers && workflowId !== undefined)
    throw new HttpError(400, 'TRIGGERS_INVALID', 'Give either triggers or workflowId, not both');
  const list = triggers
    ? checkedReplyList(triggers.reply)
    : workflowId === undefined
      ? undefined
      : [{ workflowId, enabled: true }];
  const session = await sessions.update(id, async (current) => {
    const listed = list ?? replyWorkflows(current);
    // The workflows the chat uses after this patch: a missing one is a 404, as it always was.
    const used =
      list || settings
        ? await Promise.all(listed.map((entry) => requireEntity(workflows, entry.workflowId, 'Workflow')))
        : [];
    if (rest.characterId) await requireEntity(characters, rest.characterId, 'Character');
    if (rest.personaId) await requireEntity(personas, rest.personaId, 'Persona');
    // Values are checked against the workflows the chat uses after this patch. Checked before any change.
    const nextSettings = settings ? mergeSettings(current.settings, settings, used) : undefined;
    if (rest.characterId === null) delete current.characterId;
    if (rest.personaId === null) delete current.personaId;
    Object.assign(current, Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null)));
    if (list) withReplyList(current, list);
    if (nextSettings) current.settings = nextSettings;
    return current;
  });
  if (!session) throw notFound('Session');
  return session;
}

/**
 * Merges a settings patch into the stored values: `null` removes a key (any key, declared or not), any
 * other value must fit a setting the chat's workflows declare together (`listedSettings`: the first declaration of a
 * key wins). One bad entry rejects the whole patch
 * (`400 CHAT_SETTING_INVALID`). Stored keys the patch doesn't name are kept as they are, declared or not.
 */
export function mergeSettings(
  stored: Readonly<Record<string, unknown>> | undefined,
  patch: Readonly<Record<string, unknown>>,
  workflows: readonly Workflow[],
): Record<string, unknown> {
  const declarations = new Map(listedSettings(workflows).map((setting) => [setting.key, setting]));
  const next: Record<string, unknown> = { ...stored };
  const issues: ChatSettingIssue[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
      continue;
    }
    const setting = declarations.get(key);
    const problem = setting && settingValueProblem(setting, value);
    if (!setting) issues.push({ key, message: noSetting(workflows, key) });
    else if (problem)
      issues.push({ key, message: `Chat setting "${key}": ${describeSettingValue(value)} ${problem}.` });
    else next[key] = value;
  }
  if (issues.length)
    throw new HttpError(400, 'CHAT_SETTING_INVALID', issues.map((issue) => issue.message).join(' '), { issues });
  return next;
}

// The text a chat of one workflow always had, else one that names the list.
const noSetting = (workflows: readonly Workflow[], key: string) =>
  workflows.length === 1
    ? `Workflow "${workflows[0]!.name}" has no chat setting "${key}".`
    : `None of the chat's workflows (${workflows.map((workflow) => workflow.name).join(', ')}) declares the chat setting "${key}".`;
