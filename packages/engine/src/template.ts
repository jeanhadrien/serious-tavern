import type { ExecutionContext } from './types.js';

export function renderTemplate(template: string, ctx: Pick<ExecutionContext, 'inputs' | 'trigger' | 'history'>): string {
  const scope: Record<string, unknown> = { input: ctx.inputs, inputs: ctx.inputs, trigger: ctx.trigger, history: ctx.history };
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((obj, key) =>
      obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined, scope);
    return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  });
}
export const stringify = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
