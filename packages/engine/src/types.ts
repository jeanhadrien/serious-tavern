import type { ChatMessage, PortDef } from '@st/shared';
import type { z } from 'zod';

export type EngineEvent = { type: 'node:start' | 'node:complete' | 'node:skipped' | 'node:error' | 'execution:complete'; nodeId?: string; detail?: unknown };
export type ExecutionContext = {
  inputs: Record<string, unknown>;
  config: Record<string, unknown>;
  trigger: { message: string; sessionId: string };
  history: ChatMessage[];
  secrets: { get(name: string): Promise<string | undefined> };
  signal: AbortSignal;
  log(message: string): void;
  emit(event: EngineEvent): void;
};
export type NodeDefinition = {
  type: string; label: string; description: string; category: string;
  inputs: PortDef[]; outputs: PortDef[];
  templateFields?: string[];
  configSchema: z.ZodType<Record<string, unknown>>;
  defaultConfig: Record<string, unknown>;
  timeoutMs?: number;
  execute(ctx: ExecutionContext): Promise<Record<string, unknown>>;
};
