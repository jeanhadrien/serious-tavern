import { z } from 'zod';

/**
 * Chat settings: knobs a workflow declares (`workflow.settings`) and each chat sets
 * (`session.settings`). They belong to the user: turns read them, message edits never change them.
 * Templates read the resolved values as `{{settings.<key>}}`.
 */
export const settingKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const workflowSettingTypes = ['number', 'boolean', 'enum', 'text'] as const;
// Names that would reach an object's prototype; never usable as keys (templates can't read them either).
const reservedKeys = new Set(['__proto__', 'constructor', 'prototype']);
/** A key templates can read: an identifier that is not reserved. */
export const isSettingKey = (key: string) => settingKeyPattern.test(key) && !reservedKeys.has(key);

// The schema only checks shapes, so a half-edited draft still saves; `workflowSettingIssues` reports the rest.
const base = { key: z.string(), label: z.string().optional(), description: z.string().optional() };
export const workflowSettingSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...base,
      type: z.literal('number'),
      default: z.number().default(0),
      min: z.number().optional(),
      max: z.number().optional(),
      // UI granularity only; stored values are never checked against it.
      step: z.number().optional(),
    })
    .passthrough(),
  z.object({ ...base, type: z.literal('boolean'), default: z.boolean().default(false) }).passthrough(),
  z
    .object({
      ...base,
      type: z.literal('enum'),
      options: z.array(z.string()).default([]),
      // Absent means the first option.
      default: z.string().optional(),
    })
    .passthrough(),
  z
    .object({ ...base, type: z.literal('text'), default: z.string().default(''), multiline: z.boolean().optional() })
    .passthrough(),
]);
export type WorkflowSetting = z.infer<typeof workflowSettingSchema>;
export type WorkflowSettingType = WorkflowSetting['type'];

/** Label shown in the UI: the label, or the key. */
export function settingLabel(setting: Pick<WorkflowSetting, 'key' | 'label'>): string {
  return setting.label?.trim() || setting.key;
}

/** The declared default; for an enum, the default when it is an option, else the first option, else ''. */
export function settingDefault(setting: WorkflowSetting): unknown {
  if (setting.type !== 'enum') return setting.default;
  if (setting.default !== undefined && setting.options.includes(setting.default)) return setting.default;
  return setting.options[0] ?? '';
}

/** Why `value` doesn't fit the declaration (e.g. "is above max 10"); undefined when it fits. */
export function settingValueProblem(setting: WorkflowSetting, value: unknown): string | undefined {
  switch (setting.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'is not a number';
      if (setting.min !== undefined && value < setting.min) return `is below min ${setting.min}`;
      if (setting.max !== undefined && value > setting.max) return `is above max ${setting.max}`;
      return undefined;
    case 'boolean':
      return typeof value === 'boolean' ? undefined : 'is not true or false';
    case 'enum':
      return typeof value === 'string' && setting.options.includes(value)
        ? undefined
        : `is not one of: ${setting.options.join(', ')}`;
    case 'text':
      return typeof value === 'string' ? undefined : 'is not text';
  }
}

/** A value for messages: numbers and booleans as written, anything else as JSON, cut to 40 characters. */
export function describeSettingValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = value === undefined ? 'nothing' : (JSON.stringify(value) ?? String(value));
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** Declarations a stored workflow carries, with defaults applied; items that don't parse are dropped. */
export function workflowSettings(workflow: { settings?: readonly unknown[] }): WorkflowSetting[] {
  return (workflow.settings ?? []).flatMap((item) => {
    const parsed = workflowSettingSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export type SettingDeclarationIssue = {
  index: number;
  field?: 'key' | 'type' | 'min' | 'max' | 'step' | 'default' | 'options';
  message: string;
};

/** Plain-language problems in a workflow's declarations. Raw (unparsed) items are accepted. */
export function workflowSettingIssues(settings: readonly unknown[] | undefined): SettingDeclarationIssue[] {
  const issues: SettingDeclarationIssue[] = [];
  const seen = new Set<string>();
  (settings ?? []).forEach((item, index) => {
    const number = `Chat setting #${index + 1}`;
    const parsed = workflowSettingSchema.safeParse(item);
    if (!parsed.success) {
      const type = (item as { type?: unknown } | null)?.type;
      const first = parsed.error.issues[0];
      const reason = !(workflowSettingTypes as readonly unknown[]).includes(type)
        ? `its type ${describeSettingValue(type)} is not one of: ${workflowSettingTypes.join(', ')}`
        : `${first?.path.join('.') || 'value'}: ${first?.message}`;
      issues.push({ index, field: 'type', message: `${number} is not valid: ${reason}.` });
      return;
    }
    const setting = parsed.data;
    const add = (field: SettingDeclarationIssue['field'], message: string) => issues.push({ index, field, message });
    if (!setting.key) add('key', `${number} needs a key.`);
    else if (!settingKeyPattern.test(setting.key))
      add(
        'key',
        `${number} has the key "${setting.key}", which can't be used in templates: use letters, digits and _, not starting with a digit.`,
      );
    else if (reservedKeys.has(setting.key))
      add('key', `${number} has the reserved key "${setting.key}"; pick another.`);
    else if (seen.has(setting.key))
      add('key', `More than one chat setting uses the key "${setting.key}"; keys must be unique.`);
    seen.add(setting.key);
    const name = isSettingKey(setting.key) ? `Chat setting "${setting.key}"` : number;
    if (setting.type === 'number') {
      const { min, max, step } = setting;
      if (min !== undefined && max !== undefined && min > max)
        add('min', `${name}: min ${min} is greater than max ${max}.`);
      else {
        const problem = settingValueProblem(setting, setting.default);
        if (problem) add('default', `${name}: the default ${setting.default} ${problem}.`);
      }
      if (step !== undefined && !(step > 0)) add('step', `${name}: the step must be greater than 0.`);
    }
    if (setting.type === 'enum') {
      if (!setting.options.length) add('options', `${name} needs at least one option.`);
      else if (setting.default !== undefined && !setting.options.includes(setting.default))
        add('default', `${name}: the default ${describeSettingValue(setting.default)} is not one of its options.`);
    }
  });
  return issues;
}

export type ChatSettingIssue = { key: string; message: string };

/**
 * The values a run uses: a stored value when it fits its declaration, otherwise the declared default
 * (with an issue). Stored keys the workflow doesn't declare are ignored. `stored` is never modified.
 */
export function resolveChatSettings(
  declarations: readonly WorkflowSetting[],
  stored: Readonly<Record<string, unknown>> | undefined,
): { values: Record<string, unknown>; issues: ChatSettingIssue[] } {
  const values: Record<string, unknown> = {};
  const issues: ChatSettingIssue[] = [];
  for (const setting of declarations) {
    if (!isSettingKey(setting.key) || Object.hasOwn(values, setting.key)) continue;
    const fallback = settingDefault(setting);
    if (!stored || !Object.hasOwn(stored, setting.key)) {
      values[setting.key] = fallback;
      continue;
    }
    const value = stored[setting.key];
    const problem = settingValueProblem(setting, value);
    values[setting.key] = problem ? fallback : value;
    if (problem)
      issues.push({
        key: setting.key,
        message: `Stored value ${describeSettingValue(value)} ${problem}; using default ${describeSettingValue(fallback)}`,
      });
  }
  return { values, issues };
}

/** Every key declared across workflows, for template hints: first declaration wins, sorted by key. */
export function settingsCatalog(workflows: readonly { settings?: readonly unknown[] }[]): WorkflowSetting[] {
  const byKey = new Map<string, WorkflowSetting>();
  for (const workflow of workflows)
    for (const setting of workflowSettings(workflow))
      if (isSettingKey(setting.key) && !byKey.has(setting.key)) byKey.set(setting.key, setting);
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
