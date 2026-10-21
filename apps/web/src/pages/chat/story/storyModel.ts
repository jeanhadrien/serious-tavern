import {
  isPlainObject,
  type HistoryPoint,
  type ItemLinkView,
  type KeyMeta,
  type SessionStateView,
  type StateWarning,
} from '@st/shared';
import { formatValue, itemFields, itemText } from './format.js';
import { groupLinked, itemLinkOf, type LinkGroups } from './linkedGroups.js';
import { sparklinePoints, type Sparkline } from './sparklinePoints.js';
import { threadSummaryOf, type ThreadSummary } from './threadItems.js';

// The view model of the Story state section: pure functions over the `GET /api/sessions/:id/state` answer. The
// view has no key types (nothing in this phase needed them), so a key's kind is read off its value, and a thread's
// items are recognized by their summary shape (`threadItems.ts`).

export type KeyKind = 'number' | 'boolean' | 'text' | 'object' | 'list';

/**
 * One item of a collection: its text and the declared extra fields (never the bookkeeping `id`, `entryKey`, `messages`
 * and `link`), and the link to chat messages the server computed for it when it has one.
 */
export type Item = {
  id: string;
  text: string;
  extras: { name: string; value: string }[];
  link?: ItemLinkView;
  /** A thread's exchange: what the view says about it (its tool calls, the run whose log holds it). */
  thread?: ThreadSummary;
};
export type LinkedItem = Item & { link: ItemLinkView };

export type KeyRow = {
  key: string;
  kind: KeyKind;
  value: unknown;
  written: boolean;
  writtenAtTurn: number | null;
  /** The turn that wrote it has a reply in the thread to scroll to. */
  jumpable: boolean;
  /** Lists only, newest first. */
  items: Item[];
  /** Lists with items that link to chat messages: those items grouped for display (`items` still holds all). */
  linked?: LinkGroups<LinkedItem>;
  /** Lists only: the items without a link, newest first. */
  plain: Item[];
  /** A thread key: it has items and all of them are exchanges. */
  exchanges: boolean;
  /** Lists only: items the definition's cap cut off. */
  dropped: number;
  /** Numeric keys with at least two numeric history points. */
  spark?: Sparkline;
};

export type DefinitionBlock = {
  id: string;
  name: string;
  keys: KeyRow[];
  warnings: StateWarning[];
  /** Any key written, or any warning: the rest is listed in one muted line. */
  used: boolean;
};

type NodeMemoryRow = KeyRow & { older: number };
/** `workflowId` is the workflow whose node it is (absent for what was stored before a chat ran several workflows). */
export type NodeMemoryBlock = { nodeId: string; workflowId?: string; label: string; keys: NodeMemoryRow[] };

/** How many of a node's newest items its memory shows; the rest is "and N older". */
export const NODE_ITEMS_SHOWN = 8;
export const REMOVED_NODE_LABEL = 'A node that no longer exists';

export function kindOf(value: unknown): KeyKind {
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'text';
  return 'object';
}

function itemOf(raw: unknown, index: number): Item {
  if (!isPlainObject(raw)) return { id: String(index), text: formatValue(raw), extras: [] };
  const link = itemLinkOf(raw);
  const thread = threadSummaryOf(raw);
  return {
    id: typeof raw.id === 'string' ? raw.id : String(index),
    text: itemText(raw),
    extras: itemFields(raw),
    ...(link && { link }),
    ...(thread && { thread }),
  };
}

const isLinked = (item: Item): item is LinkedItem => item.link !== undefined;

type KeyViews = {
  values: Record<string, unknown>;
  meta: Record<string, KeyMeta | undefined>;
  history: Record<string, HistoryPoint[] | undefined>;
};

/** The numbers of the turns that still count and have a reply (a turn that ran no Chat Output has none). */
function repliedTurns(view: SessionStateView): ReadonlySet<number> {
  const turns = new Set<number>();
  for (const { turnNumber, replies } of view.turns) if (turnNumber !== null && replies > 0) turns.add(turnNumber);
  return turns;
}

function keyRows({ values, meta, history }: KeyViews, replied: ReadonlySet<number>): KeyRow[] {
  return Object.entries(values).map(([key, value]) => {
    const kind = kindOf(value);
    const facts = meta[key];
    const spark = kind === 'number' ? sparklinePoints(history[key] ?? []) : undefined;
    const items = Array.isArray(value) ? value.map(itemOf) : [];
    const linkedItems = items.filter(isLinked);
    const writtenAtTurn = facts?.writtenAtTurn ?? null;
    return {
      key,
      kind,
      value,
      written: facts?.written ?? false,
      writtenAtTurn,
      jumpable: writtenAtTurn !== null && replied.has(writtenAtTurn),
      items,
      plain: items.filter((item) => !isLinked(item)),
      exchanges: items.length > 0 && items.every((item) => item.thread !== undefined),
      ...(linkedItems.length > 0 && { linked: groupLinked(linkedItems) }),
      dropped: facts?.droppedByCap ?? 0,
      ...(spark && { spark }),
    };
  });
}

/** The state definitions' blocks, in the view's order (oldest definition first). */
export function definitionBlocks(view: SessionStateView): DefinitionBlock[] {
  const replied = repliedTurns(view);
  return view.definitions.map((definition) => {
    const keys = keyRows(definition, replied);
    return {
      id: definition.definitionId,
      name: definition.name,
      keys,
      warnings: definition.warnings,
      used: definition.warnings.length > 0 || keys.some((key) => key.written),
    };
  });
}

/** What nodes remember under their own implicit keys (Draw's recent draws). Only keys that were written exist. */
export function nodeMemory(view: SessionStateView): NodeMemoryBlock[] {
  const replied = repliedTurns(view);
  return view.nodes
    .map((node) => ({
      nodeId: node.nodeId,
      ...(node.workflowId !== undefined && { workflowId: node.workflowId }),
      label: node.label ?? REMOVED_NODE_LABEL,
      keys: keyRows(node, replied).map((row) => {
        const omitted = node.omitted[row.key] ?? 0;
        return {
          ...row,
          items: row.items.slice(0, NODE_ITEMS_SHOWN),
          plain: row.plain.slice(0, NODE_ITEMS_SHOWN),
          older: omitted + Math.max(0, row.items.length - NODE_ITEMS_SHOWN),
        };
      }),
    }))
    .filter((node) => node.keys.length > 0);
}

/** Whether any turn that still counts stored something (definition keys or node memory). */
export function hasStoredState(view: SessionStateView): boolean {
  return view.turns.some((turn) => turn.turnNumber !== null && turn.writes.length > 0);
}

/**
 * The run whose replies belong to turn number `turn` (1-based among the turns that still count), or undefined when
 * that turn has no reply to scroll to.
 */
export function replyExecutionId(view: SessionStateView, turn: number): string | undefined {
  const found = view.turns.find((entry) => entry.turnNumber === turn);
  return found && found.replies > 0 ? found.executionId : undefined;
}
