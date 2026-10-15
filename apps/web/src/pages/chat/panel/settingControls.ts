import { settingValueProblem, type WorkflowSetting } from '@st/shared';

export type ControlKind = 'slider' | 'number' | 'toggle' | 'select' | 'textarea' | 'text';

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
