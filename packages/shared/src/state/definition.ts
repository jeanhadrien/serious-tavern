import { z } from 'zod';
import { describeSettingValue, isSettingKey } from '../chat-settings.js';
import type { PortDataType } from '../ports.js';
import { isPlainObject } from './helpers.js';
import { RESERVED_ITEM_FIELDS } from './node-values.js';

/**
 * State definitions: the names and typed keys a chat remembers between turns (`data/state/definitions/`).
 * Records keep unknown fields (record and key), and they are read through the YAML codec, which parses every
 * file on read, so `.default()` is safe here (consumers always see concrete values).
 */
export const stateKeyTypes = ['number', 'boolean', 'enum', 'text', 'object', 'collection'] as const;

/** Why a name is refused: definition, key and item field names are template path segments (`{{state.scene.tension}}`). */
export const TEMPLATE_NAME_RULE =
  'Use letters, digits and _, not starting with a digit; words such as this, true or toString are reserved';
const templateName = z.string().refine(isSettingKey, TEMPLATE_NAME_RULE);

export const stateKeyDefSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('number'),
      // Absent means 0, kept inside min..max.
      default: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .passthrough(),
  z.object({ type: z.literal('boolean'), default: z.boolean().optional() }).passthrough(),
  z
    .object({
      type: z.literal('enum'),
      options: z.array(z.string()).min(1, 'An enum needs at least one option'),
      // Absent means the first option.
      default: z.string().optional(),
    })
    .passthrough(),
  z.object({ type: z.literal('text'), default: z.string().optional() }).passthrough(),
  z
    .object({
      type: z.literal('object'),
      default: z.record(z.string(), z.unknown()).optional(),
      // Kept for later; nothing is checked against it yet.
      schema: z.unknown().optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal('collection'),
      // Keeps the `cap` newest items when read.
      cap: z.number().int().min(1).optional(),
      // Declared extra fields of an item (`id` and `text` always exist).
      fields: z.record(templateName, z.enum(['text', 'number', 'boolean'])).optional(),
    })
    .passthrough(),
]);
export type StateKeyDef = z.infer<typeof stateKeyDefSchema>;
export type StateKeyType = StateKeyDef['type'];
export type NumberKeyDef = Extract<StateKeyDef, { type: 'number' }>;
export type ScalarKeyDef = Exclude<StateKeyDef, { type: 'collection' }>;
export type CollectionKeyDef = Extract<StateKeyDef, { type: 'collection' }>;

// Plain-language problems the shapes above cannot express. Paths point at the field so that a YAML file's
// invalid reason reads `invalid state definition: keys.tension.max: ...`.
function checkKeys(definition: { keys: Record<string, StateKeyDef> }, ctx: z.RefinementCtx) {
  for (const [key, def] of Object.entries(definition.keys)) {
    const add = (field: string, message: string) =>
      ctx.addIssue({ code: 'custom', message: `${key}: ${message}`, path: ['keys', key, field] });
    if (def.type === 'number') {
      const { min, max } = def;
      if (min !== undefined && max !== undefined && min > max) add('max', `max ${max} must be at least min ${min}`);
      else if (def.default !== undefined) {
        const problem = keyValueProblem(def, def.default);
        if (problem) add('default', `the default ${def.default} ${problem}`);
      }
    }
    if (def.type === 'enum') {
      const duplicate = def.options.find((option, index) => def.options.indexOf(option) !== index);
      if (duplicate !== undefined) add('options', `the option ${describeSettingValue(duplicate)} is listed twice`);
      else if (def.default !== undefined && !def.options.includes(def.default))
        add('default', `the default ${describeSettingValue(def.default)} is not one of its options`);
    }
    if (def.type === 'collection')
      for (const field of ['id', 'text'].filter((name) => def.fields && Object.hasOwn(def.fields, name)))
        add('fields', `"${field}" is part of every item already; pick another field name`);
  }
}

/** The editable fields of a stored definition: a hand-written file may leave out `keys`. */
export const stateDefinitionFieldsSchema = z
  .object({
    name: templateName,
    description: z.string().optional(),
    keys: z.record(templateName, stateKeyDefSchema).default({}),
  })
  .passthrough()
  .superRefine(checkKeys);

// What a client may not declare: the built-in item properties (see `RESERVED_ITEM_FIELDS`). Checked on writes only, so
// a stored definition that already has such a field stays valid (its values are simply not stored).
function checkReservedFields(definition: { keys: Record<string, StateKeyDef> }, ctx: z.RefinementCtx) {
  for (const [key, def] of Object.entries(definition.keys))
    if (def.type === 'collection')
      for (const field of [...RESERVED_ITEM_FIELDS].filter((name) => def.fields && Object.hasOwn(def.fields, name)))
        ctx.addIssue({
          code: 'custom',
          message: `${key}: "${field}" is a built-in property of items; pick another field name`,
          path: ['keys', key, 'fields'],
        });
}

/**
 * What a client writes: everything but identity and timestamps. `keys` is required here, because a write
 * replaces the keys and a body that left them out would silently erase them.
 */
export const stateDefinitionWriteSchema = stateDefinitionFieldsSchema
  .safeExtend({ keys: z.record(templateName, stateKeyDefSchema) })
  .passthrough()
  .superRefine(checkReservedFields);
export type StateDefinitionFields = z.input<typeof stateDefinitionWriteSchema>;

/** A stored definition (`data/state/definitions/*.yaml`). */
export const stateDefinitionSchema = stateDefinitionFieldsSchema
  .safeExtend({ id: z.string().uuid(), createdAt: z.string(), updatedAt: z.string() })
  .passthrough();
export type StateDefinition = z.infer<typeof stateDefinitionSchema>;

/** The value a key reads as when nothing (valid) was written. Always a fresh value. */
export function keyDefault(def: StateKeyDef): unknown {
  switch (def.type) {
    case 'number':
      return clampToKey(def, def.default ?? 0);
    case 'boolean':
      return def.default ?? false;
    case 'enum':
      return def.default !== undefined && def.options.includes(def.default) ? def.default : (def.options[0] ?? '');
    case 'text':
      return def.default ?? '';
    case 'object':
      return structuredClone(def.default ?? {});
    case 'collection':
      return [];
  }
}

/** Why `value` doesn't fit a scalar key (e.g. "is above max 10"); undefined when it fits. */
export function keyValueProblem(def: ScalarKeyDef, value: unknown): string | undefined {
  switch (def.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'is not a number';
      if (def.min !== undefined && value < def.min) return `is below min ${def.min}`;
      if (def.max !== undefined && value > def.max) return `is above max ${def.max}`;
      return undefined;
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'is not true or false';
    case 'enum':
      return typeof value === 'string' && def.options.includes(value)
        ? undefined
        : `is not one of: ${def.options.join(', ')}`;
    case 'text':
      return typeof value === 'string' ? undefined : 'is not text';
    case 'object':
      return isPlainObject(value) ? undefined : 'is not an object';
  }
}

/** Keeps `value` inside the key's min and max. */
export function clampToKey(def: NumberKeyDef, value: number): number {
  const atLeast = def.min === undefined ? value : Math.max(def.min, value);
  return def.max === undefined ? atLeast : Math.min(def.max, atLeast);
}

/**
 * A number key after adding `by` to its current value (the key's default when `current` isn't a number),
 * kept inside min and max. The one formula behind State Write's output and the stored `set`.
 */
export function incrementedValue(def: NumberKeyDef, current: unknown, by: number): number {
  return clampToKey(def, (typeof current === 'number' ? current : (keyDefault(def) as number)) + by);
}

export const stateNodeOps = ['set', 'increment', 'add', 'remove', 'delete'] as const;
export type StateNodeOp = (typeof stateNodeOps)[number];

/** The operations a State Write node offers for a key type, in the order the editor lists them. */
export function stateOpsFor(type: StateKeyType): StateNodeOp[] {
  switch (type) {
    case 'number':
      return ['set', 'increment', 'delete'];
    case 'collection':
      return ['add', 'remove', 'delete'];
    default:
      return ['set', 'delete'];
  }
}

/** The port type a key's value travels as. */
export function stateKeyPortType(type: StateKeyType): PortDataType {
  switch (type) {
    case 'number':
    case 'boolean':
    case 'object':
      return type;
    case 'collection':
      return 'array';
    default:
      return 'text';
  }
}
