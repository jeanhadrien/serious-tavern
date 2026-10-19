import {
  parseWorkflowSetting,
  workflowSettingIssues,
  type WorkflowSetting,
  type WorkflowSettingType,
} from '@st/shared';

// Fields that belong to one setting type; changing the type drops them. Anything else (key, label,
// description, fields from a newer version) is kept.
const typeFields = ['default', 'min', 'max', 'step', 'options', 'multiline'] as const;

/**
 * The draft's declarations as a list. The draft keeps the stored value raw (items that don't parse
 * included, so a save never drops them); a stored non-list counts as no rows.
 */
export const draftList = (settings: unknown): readonly unknown[] => (Array.isArray(settings) ? settings : []);

/**
 * Why the draft can't be saved: a declaration the API would refuse (an unknown type, a wrong field type)
 * or a non-list. The user removes or fixes it on purpose; it is never dropped silently.
 */
export function unsavableSettings(settings: unknown): string | undefined {
  if (settings !== undefined && !Array.isArray(settings)) return workflowSettingIssues(settings)[0]?.message;
  for (const [index, item] of draftList(settings).entries()) {
    const parsed = parseWorkflowSetting(item, index);
    if ('problem' in parsed) return parsed.problem;
  }
  return undefined;
}

/**
 * The workflow as the editor drafts it. Older files have no `settings`; only that is normalized, so adding
 * then removing a setting is not a change. Items stay raw: one that doesn't parse is shown read-only and
 * saved unchanged (or the save is refused), never dropped.
 */
export const withDraftSettings = <T extends { settings?: unknown }>(stored: T): T => ({
  ...stored,
  settings: stored.settings ?? [],
});

/** A new number setting with the first free `setting<N>` key. */
export function newSetting(existing: readonly unknown[]): WorkflowSetting {
  const keys = new Set(existing.map((item) => (item as { key?: unknown } | null)?.key));
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

/**
 * The toolbar's Chat settings toggle. A selected node's config covers the settings panel, so the toggle acts
 * on what is shown: while a node covers the open panel, it deselects the node and brings the settings back.
 */
export const toggleSettingsPanel = (shown: boolean) => ({ open: !shown, deselect: !shown });
