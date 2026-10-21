import type { PromptMessage, ReplayPolicy } from '@st/shared';

/**
 * The prompt as the model should see the earlier reasoning: an assistant message keeps its `reasoning` and
 * `provider_data` only when the policy allows (`sinceLastUser`: it comes after the last user message) AND the same
 * provider record and model produced it (its `provenance`; a message without one is never replayed). Everything
 * else loses both fields in the copy sent to the model. Stored messages are never touched, and neither are the
 * messages of the running tool loop: they are added after this step.
 */
export function applyReplayPolicy(
  messages: readonly PromptMessage[],
  policy: ReplayPolicy,
  current: { providerId: string; model: string },
): PromptMessage[] {
  const lastUser = messages.map((message) => message.role).lastIndexOf('user');
  const allowed = (message: PromptMessage, index: number) =>
    policy !== 'never' &&
    (policy === 'always' || index > lastUser) &&
    message.provenance?.providerId === current.providerId &&
    message.provenance.model === current.model;
  return messages.map((message, index) => {
    if (message.reasoning === undefined && message.provider_data === undefined) return message;
    if (allowed(message, index)) return message;
    const { reasoning: _reasoning, provider_data: _providerData, ...plain } = message;
    return plain;
  });
}
