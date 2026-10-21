import { canConnect, type PortDef } from '@st/shared/ports';
import type { NodeTypeDescriptor } from '@st/shared';
import { compareTypes } from './nodeTypeOrder.js';

/** The handle a connection drag started from: an output (`source`) or an input (`target`). */
export interface DragOrigin {
  side: 'source' | 'target';
  port: PortDef;
}

/** A node type the picker offers, and the port a dragged connection would use. */
export interface Candidate {
  descriptor: NodeTypeDescriptor;
  /** Absent for a quick add, where no connection is being made. */
  port?: PortDef;
  /** The connection needs a conversion (e.g. number → text), like a dashed edge on the canvas. */
  coerce: boolean;
}

/**
 * The node types offered when a connection is dropped on empty canvas: those with a port the dragged one can connect
 * to, in the editor's one type order (`compareTypes`). Without an origin (quick add) every type is offered, with no
 * port. Per type the first exact fit wins over one that coerces.
 *
 * A type with `dynamicPorts` is judged by the ports its descriptor lists (its defaults); one whose defaults don't
 * fit isn't offered, because its real ports are only known once it has a config.
 */
export function connectCandidates(
  origin: DragOrigin | undefined,
  types: NodeTypeDescriptor[],
  options: { hasChatInput: boolean },
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const descriptor of types) {
    if (descriptor.type === 'chat-input' && options.hasChatInput) continue;
    if (!origin) {
      candidates.push({ descriptor, coerce: false });
      continue;
    }
    const ports = origin.side === 'source' ? descriptor.inputs : descriptor.outputs;
    let best: Candidate | undefined;
    for (const port of ports) {
      const result = origin.side === 'source' ? canConnect(origin.port, port) : canConnect(port, origin.port);
      if (!result.ok) continue;
      const candidate = { descriptor, port, coerce: result.coerce !== undefined };
      if (!candidate.coerce) {
        best = candidate;
        break;
      }
      best ??= candidate;
    }
    if (best) candidates.push(best);
  }
  return candidates.sort((a, b) => compareTypes(a.descriptor, b.descriptor));
}

/** Keeps candidates whose type label, category or port (when there is one) matches every word of the filter (case-insensitive). */
export function filterCandidates(candidates: Candidate[], query: string): Candidate[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return candidates;
  return candidates.filter(({ descriptor, port }) => {
    const text = [descriptor.label, descriptor.type, descriptor.category, port?.label, port?.name]
      .join(' ')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Where the picker's top-left goes: at the drop point, moved back inside the canvas when it would overflow. */
export function clampToBounds(
  at: { x: number; y: number },
  bounds: { width: number; height: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  const fit = (value: number, room: number, extent: number) => Math.max(0, Math.min(value, room - extent));
  return { x: fit(at.x, bounds.width, size.width), y: fit(at.y, bounds.height, size.height) };
}
