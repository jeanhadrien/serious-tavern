import type {
  Access,
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
  // `node:delta` carries `{ textDelta?, reasoningDelta? }`.
  detail?: unknown;
};
export type NodeResources = {
  presets: { get(id: string): Promise<Preset | undefined> };
  characters?: { get(id: string): Promise<Character | undefined> };
  // Provider records by id. Built-in providers always resolve, with or without this.
  providers?: { get(id: string): Promise<Provider | undefined> };
  // Authored collections by id (Recall, Draw). Read-only for workflows: no node writes them.
  collections?: { get(id: string): Promise<Collection | undefined> };
  // State definitions by id (State Read and State Write resolve their ports from them). `list` (all of them) is how
  // templates' `{{state.<name>.<key>}}` references are mapped to definitions when the run's access is computed; without it
  // every state reference counts as a read of all story state.
  stateDefinitions?: {
    get(id: string): Promise<StateDefinition | undefined>;
    list?(): Promise<StateDefinition[]>;
  };
};
// Where a write goes: a definition's key, or the writing node's own implicit key (Draw's `draws`).
export type StateWriteTarget =
  | { kind: 'definition'; definitionId: string; key: string }
  | { kind: 'node'; key: string };
// What a node asks to store. Requests are buffered and resolved into stored `StateWrite`s when the run ends:
// `increment` becomes a `set` with the post-value, and `add` gets the item id the buffer mints for it.
export type StateWriteRequest =
  | { target: StateWriteTarget; op: 'set'; value: unknown }
  | { target: StateWriteTarget; op: 'add'; item: { text: string } & Record<string, unknown> }
  | { target: StateWriteTarget; op: 'remove'; itemId: string }
  | { target: StateWriteTarget; op: 'delete' }
  | { target: Extract<StateWriteTarget, { kind: 'definition' }>; op: 'increment'; by: number };
// Read access to the story state as it was when the turn started. Writes made during the run are never
// visible here.
export type StateAccess = {
  // The turn being run (1-based; 1 when the run has no state snapshot).
  readonly turn: number;
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
  // `turn` is the turn being run; present only when the run was given a state snapshot.
  trigger: { message: string; sessionId: string; turn?: number };
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
  // Asks to store story state. Buffered: nothing is stored unless this node completes, and the run's
  // stored writes are returned with its result (and with `ExecutionFailure`). `add` returns the item with
  // the id it will be stored under.
  writeState(request: StateWriteRequest): { item?: CollectionItem };
  // Stores the node's HTTP exchange in the execution log (`wire`); each call replaces the previous one.
  recordWire(exchange: WireExchange): void;
  emit(event: EngineEvent): void;
};
// What `NodeDefinition.access` is told about the node it describes.
export type NodeAccessInfo = {
  // The node's output ports that some connection uses.
  connected: ReadonlySet<string>;
  // A state definition by id (from the listing the run loaded); undefined when there is none with that id.
  definition(id: string): StateDefinition | undefined;
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
  // The templates the node renders that come from a resource instead of its config (the LLM's preset). Used with
  // `templateFields` to work out what the node reads of the chat's shared data.
  resourceTemplates?: (config: Record<string, unknown>, resources: NodeResources) => Promise<string[]>;
  // What the node reads and writes of the chat's shared data (story state, the chat's messages) when it runs, beyond what its
  // templates read. REQUIRED, so that a new node cannot forget it: the workflows of a chat's reply list run at the same
  // time unless one writes what another reads (see `Access`). A node that touches none returns `noAccess()`. Never read
  // `ctx.state` or `ctx.history` in `execute` without declaring it here.
  access(config: Record<string, unknown>, info: NodeAccessInfo): Access;
  configSchema: z.ZodType<Record<string, unknown>>;
  defaultConfig: Record<string, unknown>;
  timeoutMs?: number;
  // A sink always runs (once its inputs are ready), and so does everything it depends on, even when no Chat
  // Output needs it: nodes that write somewhere. Chat Output is a sink.
  sink?: boolean;
  execute(ctx: ExecutionContext): Promise<Record<string, unknown>>;
};
