import { isPlainObject, type HistoryPoint, type KeyMeta, type SessionStateView, type StateWarning } from '@st/shared';
import { formatValue } from './format.js';
import { sparklinePoints, type Sparkline } from './sparklinePoints.js';

// The view model of the Story state section: pure functions over the `GET /api/sessions/:id/state` answer. The
// view has no key types (nothing in this phase needed them), so a key's kind is read off its value.

export type KeyKind = 'number' | 'boolean' | 'text' | 'object' | 'list';

/** One item of a collection: its text and the declared extra fields (never the bookkeeping `id` and `entryKey`). */
export type Item = { id: string; text: string; extras: { name: string; value: string }[] };

export type KeyRow = {
  key: string;
  kind: KeyKind;
  value: unknown;
  written: boolean;
  writtenAtTurn: number | null;
  /** Lists only, newest first. */
  items: Item[];
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
export type NodeMemoryBlock = { nodeId: string; label: string; keys: NodeMemoryRow[] };

/** How many of a node's newest items its memory shows; the rest is "and N older". */
export const NODE_ITEMS_SHOWN = 8;
export const REMOVED_NODE_LABEL = 'A node that no longer exists';

const BOOKKEEPING = new Set(['id', 'text', 'entryKey']);

export function kindOf(value: unknown): KeyKind {
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'text';
  return 'object';
}

function itemOf(raw: unknown, index: number): Item {
  if (!isPlainObject(raw)) return { id: String(index), text: formatValue(raw), extras: [] };
  const text = typeof raw.text === 'string' ? raw.text : formatValue(raw.text);
  const extras = Object.entries(raw)
    .filter(([name]) => !BOOKKEEPING.has(name))
    .map(([name, value]) => ({ name, value: formatValue(value) }));
  return { id: typeof raw.id === 'string' ? raw.id : String(index), text, extras };
}

type KeyViews = {
  values: Record<string, unknown>;
  meta: Record<string, KeyMeta | undefined>;
  history: Record<string, HistoryPoint[] | undefined>;
};

function keyRows({ values, meta, history }: KeyViews): KeyRow[] {
  return Object.entries(values).map(([key, value]) => {
    const kind = kindOf(value);
    const facts = meta[key];
    // One point is a lone dot that says nothing: a line needs at least two turns.
    const line = kind === 'number' ? sparklinePoints(history[key] ?? []) : undefined;
    const spark = line && line.values.length > 1 ? line : undefined;
    return {
      key,
      kind,
      value,
      written: facts?.written ?? false,
      writtenAtTurn: facts?.writtenAtTurn ?? null,
      items: Array.isArray(value) ? value.map(itemOf) : [],
      dropped: facts?.droppedByCap ?? 0,
      ...(spark && { spark }),
    };
  });
}

/** The state definitions' blocks, in the view's order (oldest definition first). */
export function definitionBlocks(view: SessionStateView): DefinitionBlock[] {
  return view.definitions.map((definition) => {
    const keys = keyRows(definition);
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
  return view.nodes
    .map((node) => ({
      nodeId: node.nodeId,
      label: node.label ?? REMOVED_NODE_LABEL,
      keys: keyRows(node).map((row) => {
        const omitted = node.omitted[row.key] ?? 0;
        return {
          ...row,
          items: row.items.slice(0, NODE_ITEMS_SHOWN),
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

/** The run that produced the reply of turn number `turn` (1-based among the turns that still count). */
export function turnExecutionId(view: SessionStateView, turn: number): string | undefined {
  return view.turns.find((entry) => entry.turnNumber === turn)?.executionId;
}
