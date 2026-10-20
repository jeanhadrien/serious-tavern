// Pure helpers of the LLM node's Tools section: which state keys the model may read and write, and the loop settings.
import type { StateDefinition } from '@st/shared';

export type ToolTarget = { definitionId: string; key: string };
export type ToolList = 'read' | 'write';

const isTarget = (value: unknown): value is ToolTarget =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ToolTarget).definitionId === 'string' &&
  typeof (value as ToolTarget).key === 'string';

/** The keys of one tool list, whatever the config holds (a node saved before tools existed has none). */
export function toolTargets(config: Record<string, unknown>, list: ToolList): ToolTarget[] {
  const tools = config.tools;
  const items = typeof tools === 'object' && tools !== null ? (tools as Record<string, unknown>)[list] : undefined;
  return Array.isArray(items) ? items.filter(isTarget) : [];
}

const sameTarget = (a: ToolTarget, b: ToolTarget) => a.definitionId === b.definitionId && a.key === b.key;

/** Whether a target can be added to a list: both parts chosen, and not already in it. */
export const canAddTarget = (config: Record<string, unknown>, list: ToolList, target: ToolTarget) =>
  Boolean(target.definitionId && target.key) && !toolTargets(config, list).some((item) => sameTarget(item, target));

function withList(config: Record<string, unknown>, list: ToolList, targets: ToolTarget[]): Record<string, unknown> {
  const tools = typeof config.tools === 'object' && config.tools !== null ? config.tools : {};
  return {
    ...config,
    tools: { ...tools, read: toolTargets(config, 'read'), write: toolTargets(config, 'write'), [list]: targets },
  };
}

/** The config with `target` added to the end of a list; a target that is already there (or incomplete) changes nothing. */
export function addTarget(
  config: Record<string, unknown>,
  list: ToolList,
  target: ToolTarget,
): Record<string, unknown> {
  if (!canAddTarget(config, list, target)) return config;
  return withList(config, list, [...toolTargets(config, list), { definitionId: target.definitionId, key: target.key }]);
}

/** The config without the target at `index` of a list. */
export function removeTarget(config: Record<string, unknown>, list: ToolList, index: number): Record<string, unknown> {
  return withList(
    config,
    list,
    toolTargets(config, list).filter((_, position) => position !== index),
  );
}

/**
 * How a target reads in its list: `scene.tension`, or what is missing when the definition or the key no longer
 * exists (`known` is false: the tool is then left out at run time, with a log line).
 */
export function describeTarget(
  target: ToolTarget,
  catalog: readonly StateDefinition[],
): { label: string; known: boolean } {
  const definition = catalog.find((item) => item.id === target.definitionId);
  if (!definition) return { label: `Unknown definition (${target.definitionId})`, known: false };
  return Object.hasOwn(definition.keys, target.key)
    ? { label: `${definition.name}.${target.key}`, known: true }
    : { label: `${definition.name}: Unknown key (${target.key})`, known: false };
}

/** The step limit as typed: a whole number, at least 1; cleared, it is unset and the node's default applies. */
export function setMaxSteps(config: Record<string, unknown>, value: string): Record<string, unknown> {
  const next = { ...config };
  if (value.trim() === '') delete next.maxSteps;
  else if (Number.isFinite(Number(value))) next.maxSteps = Math.max(1, Math.trunc(Number(value)));
  return next;
}

export type ParallelChoice = 'default' | 'on' | 'off';

/** Parallel tool calls: unset leaves the choice to the backend. */
export const parallelChoice = (config: Record<string, unknown>): ParallelChoice =>
  config.parallelToolCalls === true ? 'on' : config.parallelToolCalls === false ? 'off' : 'default';

export function setParallel(config: Record<string, unknown>, choice: string): Record<string, unknown> {
  const next = { ...config };
  if (choice === 'on') next.parallelToolCalls = true;
  else if (choice === 'off') next.parallelToolCalls = false;
  else delete next.parallelToolCalls;
  return next;
}
