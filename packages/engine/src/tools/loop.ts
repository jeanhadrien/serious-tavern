import type { ConversationMessage, ToolCall } from '@st/shared';
import { shown } from '../nodes/state-key.js';
import type { ChatRequest, ChatResponse } from '../providers/index.js';
import type { ExecutionContext } from '../types.js';
import type { EngineTool } from './types.js';

export type ToolLoopOptions = {
  /** The first request: the prompt in `messages`. The loop adds the tool fields and the exchange to every call. */
  request: ChatRequest;
  /** Makes one model call and returns its whole response (the node decides between streaming and not). */
  call(request: ChatRequest): Promise<ChatResponse>;
  tools: readonly EngineTool[];
  /** How many calls the model gets before it is told to stop using tools. */
  maxSteps: number;
  /** `required` only holds for the first call; after it the model chooses, or it could never answer. */
  toolChoice: 'auto' | 'required';
  parallelToolCalls?: boolean;
  ctx: ExecutionContext;
};

const LOG_LIMIT = 120;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The arguments of a call as an object. Blank text counts as no arguments; anything else must be a JSON object. */
function parseArguments(text: string): Record<string, unknown> {
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`The arguments are not valid JSON (${errorText(error)}). Send a JSON object.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('The arguments must be a JSON object.');
  return parsed as Record<string, unknown>;
}

/** Answers one tool call with the `tool` message that goes back to the model; every failure becomes `{ "error": ... }`. */
async function answerCall(
  call: ToolCall,
  step: number,
  tools: ReadonlyMap<string, EngineTool>,
  ctx: ExecutionContext,
): Promise<ConversationMessage> {
  const { name, arguments: argumentText } = call.function;
  let result: unknown;
  let failure: string | undefined;
  try {
    const tool = tools.get(name);
    if (!tool) throw new Error(`There is no tool named "${name}". Available tools: ${[...tools.keys()].join(', ')}.`);
    result = await tool.run(parseArguments(argumentText), ctx);
  } catch (error) {
    // A stopped run is not a tool error.
    ctx.signal.throwIfAborted();
    failure = errorText(error);
  }
  ctx.log(
    `step ${step}: ${name} ${shown(argumentText.trim() || '{}', LOG_LIMIT)} -> ${failure === undefined ? 'ok' : `error: ${shown(failure, LOG_LIMIT)}`}`,
  );
  const content = JSON.stringify(failure === undefined ? result : { error: failure }) ?? 'null';
  return { role: 'tool', tool_call_id: call.id, content };
}

/**
 * Runs the model against the tools until it answers without calling one. Each step is one model call; the calls it
 * makes are run one after another in the order it sent them, so their writes and rolls have a fixed order. After
 * `maxSteps` steps that still called tools, one more call is made with `tool_choice: 'none'` (the tools stay
 * declared: some backends refuse a history with tool calls and no tools). Returns the exchange (each step's
 * assistant message, then the `tool` messages answering it) and the last response. Without tools it is one call.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<{
  exchange: ConversationMessage[];
  response: ChatResponse;
}> {
  const { request, call, tools, maxSteps, ctx } = options;
  const byName = new Map(tools.map((tool) => [tool.definition.function.name, tool]));
  const exchange: ConversationMessage[] = [];
  const declared = tools.map((tool) => tool.definition);

  for (let step = 1; ; step++) {
    const closing = declared.length > 0 && step > maxSteps;
    if (closing) ctx.log(`Step limit (${maxSteps}) reached: asking for a final answer without tool use`);
    ctx.signal.throwIfAborted();
    // One HTTP call, one wire log entry.
    ctx.beginWire();
    const response = await call({
      ...request,
      messages: [...request.messages, ...exchange],
      // Nothing about tools is sent unless some are declared.
      ...(declared.length > 0 && {
        tools: declared,
        toolChoice: closing ? 'none' : step === 1 ? options.toolChoice : 'auto',
        ...(options.parallelToolCalls !== undefined && { parallelToolCalls: options.parallelToolCalls }),
      }),
    });
    const calls = response.message.tool_calls ?? [];
    if (declared.length === 0 || calls.length === 0) {
      exchange.push(response.message);
      return { exchange, response };
    }
    if (closing) {
      // The model ignored 'none'. Calls nobody answers would leave the exchange invalid, so the answer is its text.
      const { tool_calls: _calls, ...answer } = response.message;
      exchange.push(answer);
      ctx.log('The model asked for tools after the step limit; those calls were ignored');
      return { exchange, response };
    }
    exchange.push(response.message);
    for (const toolCall of calls) exchange.push(await answerCall(toolCall, step, byName, ctx));
  }
}
