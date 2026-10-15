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
 * Applies a metadata patch's answer (workflow, character, persona) to the open chat. Messages stay local, and
 * so do settings: only the chat panel changes them, and its saves may have been handled after this patch.
 */
export function withStoredMetadata(current: Session | undefined, stored: Session): Session | undefined {
  if (current?.id !== stored.id) return current;
  const { settings: _stored, ...rest } = stored;
  return {
    ...rest,
    messages: current.messages,
    ...(current.settings === undefined ? {} : { settings: current.settings }),
  };
}
