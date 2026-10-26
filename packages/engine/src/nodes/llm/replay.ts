import type { PromptMessage, ReplayPolicy } from '@st/shared';

/**
 * The prompt as the model should see the earlier reasoning, a plain filter on the rendered prompt: `never` strips
 * `reasoning` and `provider_data` from every message, `sinceLastUser` keeps them only on the messages after the last
 * user message, `always` keeps them all. Where a message comes from (history, a preset entry) and which model wrote
 * it don't matter. Stored messages are never touched, and neither are the messages of the running tool loop: they
 * are added after this step.
 */
export function applyReplayPolicy(messages: readonly PromptMessage[], policy: ReplayPolicy): PromptMessage[] {
  const lastUser = messages.map((message) => message.role).lastIndexOf('user');
  const allowed = (index: number) => policy === 'always' || (policy === 'sinceLastUser' && index > lastUser);
  return messages.map((message, index) => {
    if (message.reasoning === undefined && message.provider_data === undefined) return message;
    if (allowed(index)) return message;
    const { reasoning: _reasoning, provider_data: _providerData, ...plain } = message;
    return plain;
  });
}
