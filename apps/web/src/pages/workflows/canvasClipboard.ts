import type { Edge } from '@xyflow/react';
import type { NodeInstance, NodeTypeDescriptor } from '@st/shared';
import { withDisplayNames, type CanvasNode } from './model.js';

/** What a copy puts on the system clipboard (as JSON text): the selected nodes and the edges between them. */
export interface ClipboardPayload {
  kind: typeof CLIPBOARD_KIND;
  version: 1;
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
}
interface ClipboardNode {
  id: string;
  type: string;
  config: NodeInstance['config'];
  /** The display name at copy time; informational, a paste always numbers its nodes again. */
  name?: string;
  position: { x: number; y: number };
}
interface ClipboardEdge {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export const CLIPBOARD_KIND = 'serious-tavern/nodes';
/** How far each consecutive paste of the same payload moves the nodes, in flow pixels (both axes). */
export const PASTE_OFFSET = 40;

/** The selected nodes and the edges with both ends among them, as clipboard text. */
export function serializeSelection(nodes: CanvasNode[], edges: Edge[]): string {
  const chosen = nodes.filter((node) => node.selected);
  const ids = new Set(chosen.map((node) => node.id));
  const payload: ClipboardPayload = {
    kind: CLIPBOARD_KIND,
    version: 1,
    nodes: chosen.map((node) => ({
      id: node.id,
      type: node.data.descriptor.type,
      config: node.data.config,
      name: node.data.name,
      position: node.position,
    })),
    edges: edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge) => ({
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? '',
        target: edge.target,
        targetHandle: edge.targetHandle ?? '',
      })),
  };
  return JSON.stringify(payload);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function parseNode(value: unknown): ClipboardNode | undefined {
  if (!isRecord(value) || !isText(value.id) || !isText(value.type) || !isRecord(value.config)) return;
  const { position } = value;
  if (!isRecord(position) || !isCoordinate(position.x) || !isCoordinate(position.y)) return;
  return {
    id: value.id,
    type: value.type,
    config: value.config,
    ...(isText(value.name) ? { name: value.name } : {}),
    position: { x: position.x, y: position.y },
  };
}

function parseEdge(value: unknown): ClipboardEdge | undefined {
  if (!isRecord(value)) return;
  const { source, sourceHandle, target, targetHandle } = value;
  if (!isText(source) || !isText(sourceHandle) || !isText(target) || !isText(targetHandle)) return;
  return { source, sourceHandle, target, targetHandle };
}

/** The payload in clipboard text, or undefined for anything else (it may be ordinary text: no complaint). */
export function parseClipboard(text: string): ClipboardPayload | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return;
  }
  if (!isRecord(value) || value.kind !== CLIPBOARD_KIND || value.version !== 1) return;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || value.nodes.length === 0) return;
  const nodes = value.nodes.map(parseNode);
  const edges = value.edges.map(parseEdge);
  if (nodes.some((node) => !node) || edges.some((edge) => !edge)) return;
  return { kind: CLIPBOARD_KIND, version: 1, nodes: nodes as ClipboardNode[], edges: edges as ClipboardEdge[] };
}

/**
 * The nodes and edges a paste adds: new ids, configs copied, positions moved by `offset`, all selected. Nodes of an
 * unknown type, a second Chat Input and repeated ids are left out (`skipped` says why, in plain language) together
 * with the edges that lose an end, and an edge that would share a target handle with an earlier one.
 */
export function pasteNodes(
  payload: ClipboardPayload,
  { types, existing, offset }: { types: NodeTypeDescriptor[]; existing: CanvasNode[]; offset: number },
): { nodes: CanvasNode[]; edges: Edge[]; skipped: string[] } {
  const skipped: string[] = [];
  const ids = new Map<string, string>();
  const added: CanvasNode[] = [];
  let hasChatInput = existing.some((node) => node.data.descriptor.type === 'chat-input');
  for (const source of payload.nodes) {
    if (ids.has(source.id)) continue;
    const descriptor = types.find((type) => type.type === source.type);
    if (!descriptor) {
      skipped.push(`Unknown node type "${source.type}" was not pasted`);
      continue;
    }
    if (descriptor.type === 'chat-input') {
      if (hasChatInput) {
        skipped.push(`${descriptor.label} was not pasted: a workflow has exactly one`);
        continue;
      }
      hasChatInput = true;
    }
    const id = crypto.randomUUID();
    ids.set(source.id, id);
    added.push({
      id,
      type: 'workflow',
      position: { x: source.position.x + offset, y: source.position.y + offset },
      selected: true,
      data: { descriptor, config: structuredClone(source.config), name: descriptor.label },
    });
  }
  const targets = new Set<string>();
  const edges: Edge[] = [];
  for (const edge of payload.edges) {
    const source = ids.get(edge.source);
    const target = ids.get(edge.target);
    if (!source || !target || targets.has(`${target}:${edge.targetHandle}`)) continue;
    targets.add(`${target}:${edge.targetHandle}`);
    edges.push({
      id: crypto.randomUUID(),
      source,
      sourceHandle: edge.sourceHandle,
      target,
      targetHandle: edge.targetHandle,
      selected: true,
    });
  }
  // Numbered among all nodes, like a node added from the palette; the new ones come last, so no other name moves.
  const named = withDisplayNames([...existing, ...added], types).slice(existing.length);
  return { nodes: named, edges, skipped };
}
