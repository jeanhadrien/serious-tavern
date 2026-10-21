import type {
  Character,
  ChatMessage,
  Collection,
  CollectionItem,
  Persona,
  PortDef,
  Preset,
  Provider,
  StateDefinition,
  StateKeyView,
  WireExchange,
} from '@st/shared';
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
  // `node:delta` carries a `NodeDelta`.
  detail?: unknown;
};
// What an LLM node streams. `stepStart` marks the start of every step of a tool loop after the first: the text so
// far belonged to a step that is not the answer, so the chat clears it (reasoning is kept, see TurnStream).
export type NodeDelta = { textDelta?: string; reasoningDelta?: string; stepStart?: boolean };
export type NodeResources = {
  presets: { get(id: string): Promise<Preset | undefined> };
  characters?: { get(id: string): Promise<Character | undefined> };
  // Provider records by id. Built-in providers always resolve, with or without this.
  providers?: { get(id: string): Promise<Provider | undefined> };
  // Authored collections by id (Recall, Draw). Read-only for workflows: no node writes them.
  collections?: { get(id: string): Promise<Collection | undefined> };
  // State definitions by id (State Read and State Write resolve their ports from them).
  stateDefinitions?: { get(id: string): Promise<StateDefinition | undefined> };
};
// Where a write goes: a definition's key, or the writing node's own implicit key (Draw's `draws`).
export type StateWriteTarget =
  | { kind: 'definition'; definitionId: string; key: string }
  | { kind: 'node'; key: string };
// What a node asks to store. Requests are buffered and resolved into stored `StateWrite`s when the run ends:
// `increment` becomes a `set` with the post-value, and `add` gets the item id the buffer mints for it.
export type StateWriteRequest =
  | { target: StateWriteTarget; op: 'set'; value: unknown }
  // A thread key's item is `text`, `exchange` and maybe `input` (`ThreadItemBody`); the buffer adds `turnId` and `runId`.
  | { target: StateWriteTarget; op: 'add'; item: { text: string } & Record<string, unknown> }
  | { target: StateWriteTarget; op: 'remove'; itemId: string }
  | { target: StateWriteTarget; op: 'delete' }
  | { target: Extract<StateWriteTarget, { kind: 'definition' }>; op: 'increment'; by: number }
  // A collection item's new text and/or field values (the LLM node's write tools only; never a thread's item).
  | {
      target: Extract<StateWriteTarget, { kind: 'definition' }>;
      op: 'update';
      itemId: string;
      text?: string;
      fields?: Record<string, unknown>;
    };
// Read access to the story state as it was when the turn started. Writes made during the run are never
// visible here.
export type StateAccess = {
  // The turn being run (1-based; 1 when the run has no state snapshot).
  readonly turn: number;
  // The ids of the present turns, oldest first (`StateSnapshot.turnIds`); the order a thread is woven into the chat by.
  readonly turnIds: readonly string[];
  // The `state` namespace of templates: `{ <definition name>: { <key>: value } }`. Frozen. It is a plain
  // property (no methods) because nodes pass the whole context to `renderTemplate`.
  readonly values: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  // A copy of the definition; undefined when it doesn't exist.
  definition(id: string): StateDefinition | undefined;
  // A copy of the key's value and meta at the start of the turn; undefined for an unknown definition or key.
  read(definitionId: string, key: string): StateKeyView | undefined;
  // This node's own implicit key; undefined when it was never written.
  own(key: string): StateKeyView | undefined;
};
export type ChatReply = { nodeId: string; content: string; name?: string; characterId?: string };
export type ExecutionContext = {
  nodeId: string;
  inputs: Record<string, unknown>;
  config: Record<string, unknown>;
  // `turn` is the turn being run; present only when the run was given a state snapshot. `turnId` is the turn's id (the
  // first run's execution id), when the caller gave one.
  trigger: { message: string; sessionId: string; turn?: number; turnId?: string };
  history: ChatMessage[];
  character?: Character;
  persona?: Persona;
  // The chat settings resolved for this run (`resolveChatSettings`), by declared key. Read-only; also the
  // template namespace `settings`. Nodes never read a session's stored values themselves.
  settings: Readonly<Record<string, unknown>>;
  secrets: { get(name: string): Promise<string | undefined> };
  resources: NodeResources;
  // The replies the runs above this one saved in this turn, in chat order (Chat Input's `replies`). Empty for the first run.
  replies: ChatMessage[];
  signal: AbortSignal;
  // Appends a line to the node's `logs` in the execution log, e.g. the input behind a failure.
  log(message: string): void;
  // Next value in [0, 1) of this node's deterministic stream for this run, seeded by the run seed and the
  // node id. Never use `Math.random` in a node: a run's rolls must be reproducible from its seed.
  random(): number;
  // Story state as it was when the turn started: read-only, never shows this run's writes.
  state: StateAccess;
  // The same read access with THIS node's own writes so far applied (read-your-own-writes), as the caller's fold reads
  // them (`executeWorkflow`'s `foldWith`). Only the writing node sees them: `state`, templates and other nodes keep the
  // turn-start snapshot. Equal to `state` until the node writes, and always when the caller gave no `foldWith`.
  // Computed on demand and cached until the node's next write; every call after a write may cost a fold, so call it
  // when a read needs it, not up front.
  pendingState(): StateAccess;
  // Asks to store story state. Buffered: nothing is stored unless this node completes, and the run's
  // stored writes are returned with its result (and with `ExecutionFailure`). `add` returns the item with
  // the id it will be stored under.
  writeState(request: StateWriteRequest): { item?: CollectionItem };
  // Stores the node's HTTP exchange in the execution log (`wires`). Each call updates the current entry (a request
  // is reported before it leaves and again with its response); `beginWire` starts the next entry.
  recordWire(exchange: WireExchange): void;
  // Marks the start of another HTTP call: the next `recordWire` appends a new entry. Nodes making several calls
  // (a tool loop) call it before each one; the first call needs no mark.
  beginWire(): void;
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
  // Output needs it: nodes that write somewhere. Chat Output is a sink. A function decides from the node's config
  // (an LLM node is a sink when its tools can write state); read it only through `isSink`.
  sink?: boolean | ((config: Record<string, unknown>) => boolean);
  execute(ctx: ExecutionContext): Promise<Record<string, unknown>>;
};

/** Whether a node of this type, with this config, is a sink. */
export const isSink = (definition: NodeDefinition, config: Record<string, unknown>): boolean =>
  typeof definition.sink === 'function' ? definition.sink(config) : !!definition.sink;
