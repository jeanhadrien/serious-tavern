import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Keywords whose value is one sub-schema, a list of them, or a map of them. Everything else (`default`, `const`,
// `enum`, ...) is data and must be left alone, since a property may well be called `pattern` or `propertyNames`.
const SCHEMA_KEYWORDS = ['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains'];
const SCHEMA_LIST_KEYWORDS = ['anyOf', 'oneOf', 'allOf'];
const SCHEMA_MAP_KEYWORDS = ['properties', 'patternProperties'];

/**
 * Removes what only adds noise or trips up clients, without changing what validates: the `$schema` marker, the
 * constraint on record keys, "any value" extra properties (the default anyway), the safe-integer bounds zod puts on
 * every integer, and the uuid regex that repeats `format: uuid`.
 */
function clean(schema: unknown): unknown {
  if (!isRecord(schema)) return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema' || key === 'propertyNames') continue;
    if (key === 'additionalProperties' && isRecord(value) && Object.keys(value).length === 0) continue;
    if ((key === 'minimum' || key === 'maximum') && Math.abs(Number(value)) === Number.MAX_SAFE_INTEGER) continue;
    if (key === 'pattern' && schema.format === 'uuid') continue;
    if (SCHEMA_KEYWORDS.includes(key)) result[key] = clean(value);
    else if (SCHEMA_LIST_KEYWORDS.includes(key) && Array.isArray(value)) result[key] = value.map(clean);
    else if (SCHEMA_MAP_KEYWORDS.includes(key) && isRecord(value))
      result[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, clean(sub)]));
    else result[key] = value;
  }
  return result;
}

/**
 * The JSON Schema (draft-07, the most widely understood) of what a client may send for a zod schema. Throws on a
 * schema JSON cannot express (a binary body), so such an endpoint cannot become a tool by accident.
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
  return clean(z.toJSONSchema(schema, { io: 'input', target: 'draft-7', unrepresentable: 'throw' })) as JsonSchema;
}

/** True when the endpoint takes a body (the contract marks "none" as `z.unknown()`). */
export const takesBody = (body: z.ZodType) => body.def.type !== 'unknown';

/** True when the body may not be left out. */
export const requiresBody = (body: z.ZodType) => !body.safeParse(undefined).success;
