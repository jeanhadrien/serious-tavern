import { templateWarnings } from '@st/shared';
import { isKeyValueRows } from './fields.js';

/**
 * The warnings under one template field of the generic form: a text field's template, or each row's value of a
 * key/value list (HTTP Request's headers). The checking itself is shared's `templateWarnings`; `inputKeys` are the
 * node's input port names, the only `{{input.<key>}}` a node template can read. Repeats are listed once.
 */
export function templateFieldWarnings(value: unknown, inputKeys: readonly string[]): string[] {
  const templates = isKeyValueRows(value) ? value.map((row) => row.value) : typeof value === 'string' ? [value] : [];
  return [...new Set(templates.flatMap((template) => templateWarnings(template, { inputKeys })))];
}
