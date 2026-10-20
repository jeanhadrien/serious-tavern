import type { ToolDefinition } from '@st/shared';
import type { ExecutionContext } from '../types.js';

/**
 * A tool the LLM node offers the model. The loop has already parsed the call's arguments into a JSON object; the
 * tool checks what it needs, does its work and returns a JSON value for the `tool` message. A throw is not a node
 * failure: its message goes back to the model as `{ "error": ... }`, so say what is wrong in plain words.
 */
export type EngineTool = {
  definition: ToolDefinition;
  run(args: Record<string, unknown>, ctx: ExecutionContext): Promise<unknown>;
};
