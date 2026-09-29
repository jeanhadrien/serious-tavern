import type { ExecutionContext } from './types.js';
import type { Character, Persona } from '@st/shared';

export type TemplateContext = {
  inputs: Record<string, unknown>;
  trigger: { message: string; sessionId: string };
  history?: unknown[];
  character?: Character;
  persona?: Persona;
};

const characterFields = new Set([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes',
  'system_prompt', 'post_history_instructions'
]);
const personaFields = new Set(['name', 'description']);
const asText = (value: unknown) => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);

export function contextMacro(path: string, context: TemplateContext, expanding = new Set<string>()): string | undefined {
  const resolveField = (kind: 'char' | 'user', field: string): string => {
    const allowed = kind === 'char' ? characterFields : personaFields;
    if (!allowed.has(field)) return '';
    if (kind === 'user' && field === 'name' && !context.persona) return 'User';
    const key = `${kind}.${field}`;
    if (expanding.has(key)) return '';
    const raw = kind === 'char' ? context.character?.[field as keyof Character] : context.persona?.[field as keyof Persona];
    if (typeof raw !== 'string') return '';
    expanding.add(key);
    try { return renderContextTemplate(raw, context, undefined, expanding); }
    finally { expanding.delete(key); }
  };
  return resolveMacroValue(path, context, resolveField);
}

function resolveMacroValue(path: string, context: TemplateContext,
  resolveField: (kind: 'char' | 'user', field: string) => string): string | undefined {
  if (path === 'char') return resolveField('char', 'name');
  if (path === 'user') return context.persona?.name ? resolveField('user', 'name') : 'User';
  const [scope, field, ...rest] = path.split('.');
  if (rest.length || !field) return undefined;
  if (scope === 'char') return resolveField('char', field);
  if (scope === 'user') return resolveField('user', field);
  return undefined;
}

export function renderContextTemplate(template: string, context: TemplateContext,
  extra?: (path: string) => string | undefined, active = new Set<string>()): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    if (active.has(path)) return '';
    const value = extra?.(path) ?? contextMacro(path, context, active);
    return value ?? '';
  });
}

export function renderTemplate(template: string, ctx: TemplateContext): string {
  const scope: Record<string, unknown> = {
    input: ctx.inputs, inputs: ctx.inputs, trigger: ctx.trigger, history: ctx.history
  };
  return renderContextTemplate(template, ctx, path => {
    const value = path.split('.').reduce<unknown>((obj, key) =>
      obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined, scope);
    if (value !== undefined) return asText(value);
    return undefined;
  });
}
export const stringify = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
