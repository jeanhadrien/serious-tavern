import type { Session } from '@st/shared';

/**
 * Applies a settings save's answer to the open chat. Only `settings` is taken: the answer is the stored
 * session, whose messages lack the local rows of a streaming turn. Another chat's answer changes nothing.
 * Saves are serialized (`createSettingSaver`), so each answer holds every earlier write.
 */
export function withStoredSettings(current: Session | undefined, stored: Session): Session | undefined {
  if (current?.id !== stored.id) return current;
  const { settings: _local, ...rest } = current;
  return stored.settings === undefined ? rest : { ...rest, settings: stored.settings };
}

/**
 * Applies a reply-list save's answer to the open chat. Only `triggers` and `workflowId` (the list's first entry,
 * mirrored by the server) are taken, for the same reasons as `withStoredSettings`. Saves are serialized
 * (`createReplySaver`), so each answer holds every earlier change. A stored session without a list (an older chat) reads
 * as its `workflowId` alone, so the local list is dropped too.
 */
export function withStoredTriggers(current: Session | undefined, stored: Session): Session | undefined {
  if (current?.id !== stored.id) return current;
  const { triggers: _local, ...rest } = current;
  return {
    ...rest,
    workflowId: stored.workflowId,
    ...(stored.triggers === undefined ? {} : { triggers: stored.triggers }),
  };
}

/**
 * Applies a metadata patch's answer (title, character, persona) to the open chat. Messages stay local, and so do
 * settings and the reply list: only the chat panel changes them, and its saves may have been handled after this patch.
 */
export function withStoredMetadata(current: Session | undefined, stored: Session): Session | undefined {
  if (current?.id !== stored.id) return current;
  const { settings: _stored, triggers: _list, workflowId: _first, ...rest } = stored;
  return {
    ...rest,
    workflowId: current.workflowId,
    messages: current.messages,
    ...(current.settings === undefined ? {} : { settings: current.settings }),
    ...(current.triggers === undefined ? {} : { triggers: current.triggers }),
  };
}
