import type { WorkflowSetting, WorkflowSettingType } from '@st/shared';

// Fields that belong to one setting type; changing the type drops them. Anything else (key, label,
// description, fields from a newer version) is kept.
const typeFields = ['default', 'min', 'max', 'step', 'options', 'multiline'] as const;

/** A new number setting with the first free `setting<N>` key. */
export function newSetting(existing: readonly WorkflowSetting[]): WorkflowSetting {
  const keys = new Set(existing.map((setting) => setting.key));
  let n = 1;
  while (keys.has(`setting${n}`)) n++;
  return { key: `setting${n}`, type: 'number', default: 0 };
}

/** The setting with another type: its own fields reset to that type's defaults. */
export function withType(setting: WorkflowSetting, type: WorkflowSettingType): WorkflowSetting {
  const kept = Object.fromEntries(
    Object.entries(setting).filter(([field]) => !(typeFields as readonly string[]).includes(field)),
  ) as Pick<WorkflowSetting, 'key' | 'label' | 'description'>;
  switch (type) {
    case 'number':
      return { ...kept, type, default: 0 };
    case 'boolean':
      return { ...kept, type, default: false };
    case 'enum':
      return { ...kept, type, options: [] };
    case 'text':
      return { ...kept, type, default: '' };
  }
}

/** Moves one setting up (`-1`) or down (`1`); a no-op at either end. */
export function moveSetting<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export const removeSetting = <T>(list: readonly T[], index: number): T[] => list.filter((_, i) => i !== index);

/** Enum options from a textarea: one per line, trimmed, blank lines and repeats dropped. */
export function parseOptions(text: string): string[] {
  return [...new Set(text.split('\n').map((line) => line.trim()))].filter(Boolean);
}

export const optionsText = (options: readonly string[]) => options.join('\n');

/** Text of an optional number field: `undefined` for an empty field, otherwise the number (when it parses). */
export function optionalNumber(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}
