import { z } from 'zod';
import { noAccess } from '@st/shared';
import { registry } from './registry.js';
import type { NodeDefinition } from './types.js';

// Ad-hoc node types for workflow tests.

/** A plain node type for tests: one `value` in, one `value` out, passing the input on. */
export const testType = (type: string, extra: Partial<NodeDefinition> = {}): NodeDefinition => ({
  type,
  label: type,
  description: '',
  category: '',
  inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
  outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
  configSchema: z.object({}),
  defaultConfig: {},
  access: () => noAccess(),
  execute: async (ctx) => ({ value: ctx.inputs.value }),
  ...extra,
});

/** Registers test node types; call `unregister()` in `afterEach`. */
const registered = new Set<string>();
export function register(...definitions: NodeDefinition[]): void {
  for (const definition of definitions) {
    registered.add(definition.type);
    registry.set(definition.type, definition);
  }
}
export function unregister(): void {
  for (const type of registered) registry.delete(type);
  registered.clear();
}
