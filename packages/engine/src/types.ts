import type { Character, ChatMessage, Persona, PortDef, Preset, Provider, WireExchange } from '@st/shared';
import type { z } from 'zod';

export type EngineEvent = {
  type:
    | 'node:start'
    | 'node:delta'
    | 'node:complete'
    | 'node:skipped'
    | 'node:cancelled'
    | 'node:error'
    | 'execution:complete';
  nodeId?: string;
  // `node:delta` carries `{ textDelta?, reasoningDelta? }`.
  detail?: unknown;
};
export type NodeResources = {
  presets: { get(id: string): Promise<Preset | undefined> };
  characters?: { get(id: string): Promise<Character | undefined> };
  // Provider records by id. Built-in providers always resolve, with or without this.
  providers?: { get(id: string): Promise<Provider | undefined> };
};
export type ChatReply = { nodeId: string; content: string; name?: string; characterId?: string };
export type ExecutionContext = {
  nodeId: string;
  inputs: Record<string, unknown>;
  config: Record<string, unknown>;
  trigger: { message: string; sessionId: string };
  history: ChatMessage[];
  character?: Character;
  persona?: Persona;
  secrets: { get(name: string): Promise<string | undefined> };
  resources: NodeResources;
  signal: AbortSignal;
  log(message: string): void;
  // Next value in [0, 1) of this node's deterministic stream for this run, seeded by the run seed and the
  // node id. Never use `Math.random` in a node: a run's rolls must be reproducible from its seed.
  random(): number;
  // Stores the node's HTTP exchange in the execution log (`wire`); each call replaces the previous one.
  recordWire(exchange: WireExchange): void;
  emit(event: EngineEvent): void;
};
export type NodeDefinition = {
  type: string;
  label: string;
  description: string;
  category: string;
  inputs: PortDef[];
  outputs: PortDef[];
  resolvePorts?: (
    config: Record<string, unknown>,
    resources: NodeResources,
  ) => Promise<{ inputs: PortDef[]; outputs: PortDef[] }>;
  templateFields?: string[];
  configSchema: z.ZodType<Record<string, unknown>>;
  defaultConfig: Record<string, unknown>;
  timeoutMs?: number;
  // A sink always runs (once its inputs are ready), and so does everything it depends on, even when no Chat
  // Output needs it: nodes that write somewhere. Chat Output is a sink.
  sink?: boolean;
  execute(ctx: ExecutionContext): Promise<Record<string, unknown>>;
};
