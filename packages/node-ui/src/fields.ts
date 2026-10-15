export type Field = {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  items?: Field | Field[];
  prefixItems?: Field[];
  properties?: Record<string, Field>;
  required?: string[];
};

export function supportsKeyValueArray(field: Field): boolean {
  const item = field.items;
  if (field.type !== 'array' || field.prefixItems || !item || Array.isArray(item) || item.type !== 'object')
    return false;
  const properties = item.properties ?? {};
  return (
    Object.keys(properties).length === 2 &&
    properties.key?.type === 'string' &&
    properties.value?.type === 'string' &&
    !!item.required?.includes('key') &&
    item.required.includes('value')
  );
}

export function isKeyValueRows(value: unknown): value is { key: string; value: string }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        row !== null &&
        typeof row === 'object' &&
        !Array.isArray(row) &&
        typeof row.key === 'string' &&
        typeof row.value === 'string',
    )
  );
}

/**
 * Config value of a generic number input. A field without a default is unset when cleared, so the node can
 * apply its own fallback (Random's per-mode bounds). A field with a default keeps the old `Number('') = 0`:
 * storing unset there would redisplay the default while the user is still typing.
 */
export function numberFieldValue(text: string, field: Field): number | undefined {
  return text === '' && field.default === undefined ? undefined : Number(text);
}
