import type { NodeTypeDescriptor } from '@st/shared';
import type { NodePanelContext } from './panels/types.js';

type Config = Record<string, unknown>;
type Summarize = (config: Config, context: NodePanelContext | undefined) => string | undefined;

// The one-line summaries the editor shows under a node's header. A summary is plain text, cut by the host; it names what
// the node is set to, with the panels' own `Unknown … (id)` wording for a record that is gone, and nothing at all for
// a node that is not set up yet. A type with no entry has no line.

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** `Definition.key` for the State nodes: the definition's name, or `Unknown definition (id)`; nothing while unset. */
function stateKey(config: Config, context: NodePanelContext | undefined): string | undefined {
  const id = text(config.definitionId);
  const key = text(config.key);
  if (!id || !key) return undefined;
  const definition = context?.stateDefinitions?.find((item) => item.id === id);
  return `${definition ? definition.name : `Unknown definition (${id})`}.${key}`;
}

/** The names of the picked collections, or `Unknown collection (id)`; nothing while none is picked. */
function collections(config: Config, context: NodePanelContext | undefined): string | undefined {
  const ids = Array.isArray(config.collectionIds) ? config.collectionIds.filter((id) => typeof id === 'string') : [];
  if (!ids.length) return undefined;
  return ids
    .map((id) => context?.collections?.find((item) => item.id === id)?.name ?? `Unknown collection (${id})`)
    .join(', ');
}

/** The key and what is done to it; nothing while no key is picked. */
const withKey = (config: Config, context: NodePanelContext | undefined, action: string) => {
  const key = stateKey(config, context);
  return key && `${key} · ${action}`;
};

const joined = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ') || undefined;

const summaries: Record<string, Summarize> = {
  llm: (config, context) => {
    const presetId = text(config.presetId);
    const preset = presetId
      ? (context?.presets.find((item) => item.id === presetId)?.name ?? `Unknown preset (${presetId})`)
      : 'No preset';
    return joined(text(config.model), preset);
  },
  'state-read': (config, context) => withKey(config, context, text(config.read) || 'value'),
  'state-write': (config, context) => withKey(config, context, text(config.op) || 'set'),
  'next-chunk': stateKey,
  'unlinked-messages': stateKey,
  thread: stateKey,
  condition: (config) => text(config.operator) || undefined,
  random: (config) => text(config.mode) || 'number',
  merge: (config) => text(config.mode) || undefined,
  'parse-json': (config) => text(config.expect) || undefined,
  'http-request': (config) => joined(text(config.method), text(config.url)),
  recall: collections,
  draw: collections,
  memory: (config) => (config.all === true ? 'All messages' : `Last ${Number(config.lastN ?? 10)} messages`),
  'chat-settings': (config) => text(config.key) || undefined,
};

/**
 * The one-line summary of a node's configuration, or undefined when its type has none or it is not set up yet. Pure, and
 * tolerant of any config (nodes saved by another version may hold anything).
 */
export function nodeSummary(
  descriptor: Pick<NodeTypeDescriptor, 'type'>,
  config: Config,
  context?: NodePanelContext,
): string | undefined {
  return summaries[descriptor.type]?.(config, context);
}
