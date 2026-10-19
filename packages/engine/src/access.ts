import {
  everythingAccess,
  mergeAccess,
  templateReads,
  type Access,
  type StateDefinition,
  type Workflow,
} from '@st/shared';
import type { NodeDefinition, NodeResources } from './types.js';

/** Every text found in a config value: a string, or the strings inside lists and objects (an HTTP node's header rows). */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

/**
 * The state definitions a run can read: the whole listing when the resources have one (so templates' names map to
 * definitions: `listing` is then set), else only the definitions the nodes' configs name.
 */
async function loadDefinitions(
  workflow: Workflow,
  resources: NodeResources,
): Promise<{ byId: Map<string, StateDefinition>; listing?: StateDefinition[] }> {
  const listing = await resources.stateDefinitions?.list?.();
  const byId = new Map((listing ?? []).map((definition) => [definition.id, definition]));
  if (!listing)
    for (const { config } of workflow.nodes) {
      const id = config.definitionId;
      const found =
        typeof id === 'string' && id && !byId.has(id) ? await resources.stateDefinitions?.get(id) : undefined;
      if (found) byId.set(found.id, found);
    }
  return { byId, ...(listing ? { listing } : {}) };
}

/**
 * What a run of the workflow reads and writes of the chat's shared data, from the nodes that run (`reachable`): each
 * node's own `access`, and the template reads of everything it renders (its `templateFields`, the presets of an LLM,
 * a character card's fields: see `templateReads`). A node of an unknown type could do anything: it reads and writes
 * `everything`. The inputs are what `prepareWorkflow` already holds, so nothing is loaded twice. Pure apart from the
 * resource lookups (`resourceTemplates`, the definitions).
 */
export async function workflowAccess(input: {
  workflow: Workflow;
  reachable: ReadonlySet<string>;
  definitions: ReadonlyMap<string, NodeDefinition>;
  resources: NodeResources;
}): Promise<Access> {
  const { workflow, reachable, definitions, resources } = input;
  const { byId, listing } = await loadDefinitions(workflow, resources);
  const accesses: Access[] = [];
  const reads = (text: string) => ({ reads: templateReads(text, listing), writes: [] });
  for (const node of workflow.nodes) {
    if (!reachable.has(node.id)) continue;
    const definition = definitions.get(node.id);
    if (!definition) {
      accesses.push(everythingAccess());
      continue;
    }
    const connected = new Set(
      workflow.edges.filter((edge) => edge.source === node.id).map((edge) => edge.sourceHandle),
    );
    accesses.push(definition.access(node.config, { connected, definition: (id) => byId.get(id) }));
    const texts = [
      ...(definition.templateFields ?? []).flatMap((field) => stringsOf(node.config[field])),
      ...((await definition.resourceTemplates?.(node.config, resources)) ?? []),
    ];
    for (const text of texts) accesses.push(reads(text));
  }
  return mergeAccess(...accesses);
}
