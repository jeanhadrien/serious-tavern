/** Reasoning effort levels for LLM nodes. `off` sends nothing, leaving the model's own default in place. */
export const reasoningEfforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
