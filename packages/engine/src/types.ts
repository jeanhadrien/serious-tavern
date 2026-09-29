import type { ChatMessage, PortDef, Preset } from '@st/shared';
import type { z } from 'zod';

export type EngineEvent = { type: 'node:start' | 'node:complete' | 'node:skipped' | 'node:error' | 'execution:complete'; nodeId?: string; detail?: unknown };
export type NodeResources = { presets: { get(id: string): Promise<Preset | undefined> } };
export type ExecutionContext = {
  inputs: Record<string, unknown>;
  config: Record<string, unknown>;
  trigger: { message: string; sessionId: string };
  history: ChatMessage[];
  secrets: { get(name: string): Promise<string | undefined> };
  resources: NodeResources;
  signal: AbortSignal;
  log(message: string): void;
  recordRequest(request: unknown): void;
  emit(event: EngineEvent): void;
};
export type NodeDefinition = {
  type: string; label: string; description: string; category: string;
  inputs: PortDef[]; outputs: PortDef[];
  resolvePorts?: (config: Record<string, unknown>, resources: NodeResources) => Promise<{ inputs: PortDef[]; outputs: PortDef[] }>;
  templateFields?: string[];
  configSchema: z.ZodType<Record<string, unknown>>;
  defaultConfig: Record<string, unknown>;
  timeoutMs?: number;
  execute(ctx: ExecutionContext): Promise<Record<string, unknown>>;
};
