import type { ChatOptions, ChatRequest, ChatResponse, LlmAdapter } from '../../providers/index.js';
import type { ExecutionContext, NodeDelta } from '../../types.js';

/**
 * One model call for the LLM node: streamed (text and reasoning go out as deltas as they arrive) or whole,
 * as the node's `streaming` setting and the adapter allow. Deltas are notifications only; the outcome is the
 * accumulated response.
 */
export function modelCaller(ctx: ExecutionContext, adapter: LlmAdapter, options: ChatOptions) {
  const delta = (detail: NodeDelta) => ctx.emit({ type: 'node:delta', nodeId: ctx.nodeId, detail });
  return async (request: ChatRequest): Promise<ChatResponse> => {
    if (ctx.config.streaming !== false && adapter.stream != null)
      return adapter.stream(request, {
        ...options,
        onToken: (textDelta) => delta({ textDelta }),
        onReasoning: (reasoningDelta) => delta({ reasoningDelta }),
      });
    const response = await adapter.chat(request, options);
    // A whole reasoning trace reaches the chat like a streamed one: as a single delta.
    if (response.reasoning) delta({ reasoningDelta: response.reasoning });
    return response;
  };
}
