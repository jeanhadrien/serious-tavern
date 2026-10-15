import { settingDefault, settingValueProblem, type ChatSettingIssue, type WorkflowSetting } from '@st/shared';

export type ControlKind = 'slider' | 'number' | 'toggle' | 'select' | 'textarea' | 'text';
export type ChangeMode = 'now' | 'debounced';

/** The control a setting gets in the chat panel: a slider when a number has both bounds. */
export function controlKind(setting: WorkflowSetting): ControlKind {
  switch (setting.type) {
    case 'number':
      return setting.min !== undefined && setting.max !== undefined ? 'slider' : 'number';
    case 'boolean':
      return 'toggle';
    case 'enum':
      return 'select';
    case 'text':
      return setting.multiline ? 'textarea' : 'text';
  }
}

/** What a number field's text means: a value to save, or why it can't be saved yet. */
export function parseNumberDraft(text: string, setting: WorkflowSetting): { value: number } | { problem: string } {
  if (!text.trim()) return { problem: 'Enter a number' };
  const value = Number(text);
  const problem = settingValueProblem(setting, value);
  return problem ? { problem: `${text.trim()} ${problem}` } : { value };
}

/** When a control's changes are saved: picks save at once; typed values after a pause (never per keystroke). */
export const saveMode = (kind: ControlKind): ChangeMode =>
  kind === 'toggle' || kind === 'select' ? 'now' : 'debounced';

/**
 * What the panel shows for one setting: a value not confirmed yet wins (`null`: reset, so the default), then
 * the resolved value. It can be reset when a value is stored (or about to be); the resolver's issue is hidden
 * while a new value is on its way.
 */
export function displayedSetting(
  setting: WorkflowSetting,
  resolved: { values: Record<string, unknown>; issues: readonly ChatSettingIssue[] },
  stored: Readonly<Record<string, unknown>> | undefined,
  pending: Readonly<Record<string, unknown>>,
): { value: unknown; resettable: boolean; issue?: string } {
  const { key } = setting;
  if (Object.hasOwn(pending, key)) {
    const value = pending[key];
    return value === null ? { value: settingDefault(setting), resettable: false } : { value, resettable: true };
  }
  const issue = resolved.issues.find((item) => item.key === key)?.message;
  return {
    value: resolved.values[key],
    resettable: !!stored && Object.hasOwn(stored, key),
    ...(issue ? { issue } : {}),
  };
}
