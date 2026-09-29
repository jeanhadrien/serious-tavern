import { caseInsensitiveValue, findMacro, type Character, type Persona } from '@st/shared';

export type TemplateContext = {
  inputs: Record<string, unknown>;
  trigger: { message: string; sessionId: string };
  history?: unknown[];
  character?: Character;
  persona?: Persona;
};

const asText = (value: unknown): string =>
  value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);

export function contextMacro(
  path: string,
  context: TemplateContext,
  expanding = new Set<string>(),
): string | undefined {
  const macro = findMacro(path);
  if (!macro) return undefined;
  if (macro.source === 'character' || macro.source === 'persona') {
    const key = `${macro.source}.${macro.field}`;
    if (expanding.has(key)) return '';
    const entity = context[macro.source];
    if (!entity) return macro.defaultValue ?? '';
    const raw = entity[macro.field!];
    if (typeof raw !== 'string') return '';
    expanding.add(key);
    try {
      return renderContextTemplate(raw, context, undefined, expanding);
    } finally {
      expanding.delete(key);
    }
  }
  const parts = macro.field ? [macro.field] : path.split('.').slice(1);
  const value = parts.reduce<unknown>(caseInsensitiveValue, context[macro.source]);
  return asText(value);
}

export function renderContextTemplate(
  template: string,
  context: TemplateContext,
  extra?: (path: string) => string | undefined,
  active = new Set<string>(),
): string {
  return template.replace(/\{\{([^{}]*?)\}\}/g, (match, name: string) => {
    const path = name.trim();
    if (!findMacro(path)) return match;
    return extra?.(path.toLowerCase()) ?? contextMacro(path, context, active) ?? match;
  });
}

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return renderContextTemplate(template, ctx);
}

export const stringify = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
