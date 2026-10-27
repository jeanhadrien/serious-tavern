import { macroRegistry, type Character, type Persona } from '@st/shared';
import { createTemplateEnvironment } from './template-helpers.js';
import { stringify } from '@st/shared/ports';
import { toText } from './text.js';

export type TemplateContext = {
  inputs: Record<string, unknown>;
  // `turn` is the turn being run; absent when the run has no story state.
  trigger: { message: string; sessionId: string; turn?: number };
  history?: unknown[];
  character?: Character;
  persona?: Persona;
  // Resolved chat settings, `{{settings.<key>}}`.
  settings?: Readonly<Record<string, unknown>>;
  // Story state at the start of the turn: `values` is `{ <definition name>: { <key>: value } }`, the
  // `{{state.*}}` namespace. A `StateAccess` fits (it keeps its methods out of the template by design).
  state?: { readonly values: Readonly<Record<string, unknown>> };
  // Snippet text by name (`snippetTexts`), the `{{snippets.<name>}}` namespace.
  snippets?: Readonly<Record<string, string>>;
};

// `preset` renders inputs and bare `{{history}}` as message transcripts; `node` renders JSON.
// Character and persona fields are always rendered in `node` style; snippets in the style of the template using them.
export type TemplateStyle = 'node' | 'preset';

type CardSource = 'character' | 'persona';
type Formatter = (value: unknown) => string;

const environment = createTemplateEnvironment();

export function renderContextTemplate(
  template: string,
  context: TemplateContext,
  style: TemplateStyle = 'node',
  active = new Set<string>(),
): string {
  try {
    return environment.compile(template, { noEscape: true })(templateData(context, style, active));
  } catch {
    // A template that fails to parse or render is kept as written, so a chat turn never throws on template text.
    return template;
  }
}

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return renderContextTemplate(template, ctx);
}

function templateData(context: TemplateContext, style: TemplateStyle, active: Set<string>): Record<string, unknown> {
  const formatInputs: Formatter = style === 'preset' ? toText : stringify;
  const inputs = presented(context.inputs, formatInputs);
  const data: Record<string, unknown> = {
    input: inputs,
    inputs,
    trigger: presented(context.trigger, stringify),
    history: presented(context.history, formatInputs, stringify),
    // `{{settings}}` renders compact JSON; paths, `#if` and helpers see the raw values.
    settings: presented(context.settings ?? {}, stringify),
    // Same for `{{state}}` and `{{state.<definition>}}`; `{{#each state.<d>.<collection>}}` sees the items.
    state: presented(context.state?.values ?? {}, stringify),
    // A bare character has no alias, so it renders as empty text like any unknown name.
    character: context.character ? withToString(cardScope(context, 'character', active), () => '') : undefined,
    snippets: snippetScope(context, style, active),
  };
  if (context.persona) {
    const persona = cardScope(context, 'persona', active);
    data.persona = withToString(persona, () => cardField(context, 'persona', 'description', active));
  }
  for (const alias of macroRegistry) {
    if (alias.category !== 'alias' || alias.name === 'persona' || alias.field === undefined) continue;
    if (alias.source !== 'character' && alias.source !== 'persona') continue;
    const { source, field, defaultValue } = alias;
    lazy(data, alias.name, () => (context[source] ? cardField(context, source, field, active) : (defaultValue ?? '')));
  }
  return data;
}

// Expands a card field on first access. Cycles through `active` render as empty text.
function cardScope(context: TemplateContext, source: CardSource, active: Set<string>): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const macro of macroRegistry) {
    if (macro.category !== source || macro.field === undefined) continue;
    const field = macro.field;
    lazy(scope, field, () => cardField(context, source, field, active));
  }
  return scope;
}

function cardField(context: TemplateContext, source: CardSource, field: string, active: Set<string>): string {
  const raw = (context[source] as Record<string, unknown> | undefined)?.[field];
  const key = `${source}.${field}`;
  if (typeof raw !== 'string' || active.has(key)) return '';
  active.add(key);
  try {
    return renderContextTemplate(raw, context, 'node', active);
  } finally {
    active.delete(key);
  }
}

// Renders a snippet on first access, with the context of the template that uses it. Cycles render as empty text.
function snippetScope(context: TemplateContext, style: TemplateStyle, active: Set<string>): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const [name, text] of Object.entries(context.snippets ?? {})) {
    const key = `snippets.${name}`;
    lazy(scope, name, () => {
      if (active.has(key)) return '';
      active.add(key);
      try {
        return renderContextTemplate(text, context, style, active);
      } finally {
        active.delete(key);
      }
    });
  }
  return scope;
}

// Copies data so `{{path}}` renders through `format` while `{{#each}}` and `{{path.field}}` still see plain values.
function presented(value: unknown, format: Formatter, nested: Formatter = format): unknown {
  if (value === null || typeof value !== 'object') return value;
  const copy = Array.isArray(value)
    ? value.map((item) => presented(item, nested, nested))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, presented(item, nested, nested)]));
  return withToString(copy, () => format(value));
}

function withToString<T extends object>(target: T, format: () => string): T {
  return Object.defineProperty(target, 'toString', { value: format, enumerable: false });
}

function lazy(target: Record<string, unknown>, name: string, read: () => unknown): void {
  Object.defineProperty(target, name, { enumerable: true, get: read });
}
