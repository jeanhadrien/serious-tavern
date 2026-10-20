/** Reasoning effort levels for LLM nodes. `off` sends nothing, leaving the model's own default in place. */
export const reasoningEfforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

/** Which earlier reasoning an LLM node sends back to the model (see the engine's `applyReplayPolicy`). */
export const replayPolicies = ['never', 'sinceLastUser', 'always'] as const;
export type ReplayPolicy = (typeof replayPolicies)[number];
