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
