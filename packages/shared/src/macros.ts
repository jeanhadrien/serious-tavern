import type { PortDataType } from './ports.js';

export type MacroDefinition = {
  name: string;
  description: string;
  category: 'character' | 'persona' | 'input' | 'trigger' | 'history' | 'alias';
  source: 'character' | 'persona' | 'inputs' | 'trigger' | 'history';
  field?: string;
  defaultValue?: string;
  pattern?: RegExp;
  dataType: PortDataType;
};

const characterFields = [
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator_notes',
  'system_prompt', 'post_history_instructions', 'creator', 'character_version'
] as const;

export const macroRegistry: readonly MacroDefinition[] = [
  ...characterFields.map(field => ({
    name: `character.${field}`, description: `Character ${field.replaceAll('_', ' ')}`,
    category: 'character' as const, source: 'character' as const, field, dataType: 'text' as const
  })),
  ...(['name', 'description'] as const).map(field => ({
    name: `persona.${field}`, description: `Persona ${field}`, category: 'persona' as const,
    source: 'persona' as const, field, dataType: 'text' as const
  })),
  { name: 'char', description: 'Alias for character.name', category: 'alias', source: 'character', field: 'name', dataType: 'text' },
  { name: 'user', description: 'Persona name (User when no persona is selected)', category: 'alias',
    source: 'persona', field: 'name', defaultValue: 'User', dataType: 'text' },
  ...(['description', 'personality', 'scenario'] as const).map(field => ({
    name: field, description: `Alias for character.${field}`, category: 'alias' as const,
    source: 'character' as const, field, dataType: 'text' as const
  })),
  { name: 'persona', description: 'Alias for persona.description', category: 'alias', source: 'persona', field: 'description', dataType: 'text' },
  { name: 'input.<key>', description: 'Input value (keys are case-insensitive)', category: 'input',
    source: 'inputs', pattern: /^input\.[\w]+(?:\.[\w]+)*$/i, dataType: 'any' },
  { name: 'inputs.<key>', description: 'Node input value or nested path', category: 'input',
    source: 'inputs', pattern: /^inputs\.[\w]+(?:\.[\w]+)*$/i, dataType: 'any' },
  { name: 'input', description: 'All input values', category: 'input', source: 'inputs', dataType: 'object' },
  { name: 'inputs', description: 'All node input values', category: 'input', source: 'inputs', dataType: 'object' },
  { name: 'trigger.message', description: 'Current user message', category: 'trigger', source: 'trigger', field: 'message', dataType: 'text' },
  { name: 'trigger.sessionId', description: 'Current session ID', category: 'trigger', source: 'trigger', field: 'sessionId', dataType: 'text' },
  { name: 'trigger', description: 'Trigger context', category: 'trigger', source: 'trigger', dataType: 'object' },
  { name: 'trigger.<path>', description: 'Trigger context path', category: 'trigger', source: 'trigger',
    pattern: /^trigger\.[\w]+(?:\.[\w]+)*$/i, dataType: 'any' },
  { name: 'history', description: 'Conversation history', category: 'history', source: 'history', dataType: 'messages' },
  { name: 'history.<path>', description: 'Conversation history path', category: 'history', source: 'history',
    pattern: /^history\.[\w]+(?:\.[\w]+)*$/i, dataType: 'any' }
];

export function findMacro(name: string): MacroDefinition | undefined {
  const normalized = name.toLowerCase();
  return macroRegistry.find(macro => macro.pattern ? macro.pattern.test(name) : macro.name.toLowerCase() === normalized);
}

export function templateMacros(template: string): { expression: string; name: string; definition?: MacroDefinition }[] {
  return [...template.matchAll(/\{\{([^{}]*?)\}\}/g)].map(match => {
    const name = match[1]!.trim();
    return { expression: match[0], name, definition: findMacro(name) };
  });
}

export function macroInputKey(name: string): string | undefined {
  return findMacro(name)?.source === 'inputs' && name.includes('.') ? name.split('.')[1]!.toLowerCase() : undefined;
}

export function macroHints(inputs: readonly { key: string; dataType: PortDataType }[]) {
  return macroRegistry.flatMap(macro => {
    if (macro.pattern) {
      if (macro.source !== 'inputs') return [];
      return inputs.map(input => ({
        expression: `{{${macro.name.replace('<key>', input.key)}}}`, description: macro.description, type: input.dataType
      }));
    }
    return [{ expression: `{{${macro.name}}}`, description: macro.description, type: macro.dataType }];
  });
}

export function caseInsensitiveValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const actual = Object.keys(value).find(candidate => candidate.toLowerCase() === key.toLowerCase());
  return actual === undefined ? undefined : (value as Record<string, unknown>)[actual];
}
