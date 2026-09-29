import { describe, expect, it } from 'vitest';
import { macroRegistry, characterSchema, personaSchema } from '@st/shared';
import { renderTemplate, type TemplateContext } from './template.js';

const context = (): TemplateContext => ({
  inputs: { CamelKey: 'value', nested: { Field: 42 } },
  trigger: { message: 'Hello', sessionId: 'session' },
  history: [{ role: 'user', content: 'past' }],
  character: characterSchema.parse({
    id: 'c',
    name: 'Mira',
    description: 'Friend of {{User}}',
    personality: 'Kind',
    scenario: 'Cafe',
    first_mes: 'Hi',
    mes_example: 'Example',
    creator_notes: 'Notes',
    system_prompt: 'Prompt',
    post_history_instructions: 'End',
    alternate_greetings: [],
    tags: [],
    creator: 'Author',
    character_version: '1',
    extensions: {},
    avatar: false,
    createdAt: '',
    updatedAt: '',
  }),
  persona: personaSchema.parse({
    id: 'p',
    name: 'Alex',
    description: '{{Char}} fan',
    avatar: false,
    createdAt: '',
    updatedAt: '',
  }),
});

describe('registry-driven templates', () => {
  it('resolves every namespaced character/persona field in the registry', () => {
    const ctx = context();
    for (const macro of macroRegistry.filter((item) => item.category === 'character' || item.category === 'persona')) {
      const raw = ctx[macro.source as 'character' | 'persona']![macro.field!] as string;
      expect(renderTemplate(`{{${macro.name}}}`, ctx)).toBe(renderTemplate(raw, ctx));
    }
  });

  it('resolves aliases and case-insensitive names, fields, and input keys', () => {
    expect(
      renderTemplate('{{Char}}|{{USER}}|{{DESCRIPTION}}|{{Personality}}|{{scenario}}|{{Persona}}', context()),
    ).toBe('Mira|Alex|Friend of Alex|Kind|Cafe|Mira fan');
    expect(
      renderTemplate(
        '{{CHARACTER.Name}}|{{PERSONA.Description}}|{{INPUT.camelkey}}|{{inputs.NESTED.field}}|{{TRIGGER.SESSIONID}}',
        context(),
      ),
    ).toBe('Mira|Mira fan|value|42|session');
  });

  it('keeps unknown and removed macros verbatim and empties known missing values', () => {
    const ctx: TemplateContext = { inputs: {}, trigger: { message: '', sessionId: '' } };
    expect(
      renderTemplate('{{unknown}}|{{char.name}}|{{user.description}}|{{character.nope}}|{{random::a::b}}', ctx),
    ).toBe('{{unknown}}|{{char.name}}|{{user.description}}|{{character.nope}}|{{random::a::b}}');
    expect(
      renderTemplate('{{char}}|{{character.description}}|{{persona.name}}|{{persona}}|{{input.absent}}|{{user}}', ctx),
    ).toBe('|||||User');
  });

  it('expands nested fields and breaks cycles across aliases, casing, and persona fields', () => {
    const ctx = context();
    ctx.character!.description = '{{Personality}}';
    ctx.character!.personality = '{{CHARACTER.Description}}';
    expect(renderTemplate('{{description}} / {{character.personality}}', ctx)).toBe(' / ');
    ctx.character!.description = '{{persona.description}}';
    ctx.persona!.description = '{{Description}}';
    expect(renderTemplate('{{description}}', ctx)).toBe('');
    ctx.persona!.description = '{{character.first_mes}} {{user}}';
    expect(renderTemplate('{{description}}', ctx)).toBe('Hi Alex');
  });

  it('preserves node scope roots and nested paths without inherited-property access', () => {
    expect(renderTemplate('{{input}}|{{inputs}}|{{trigger}}|{{history.0.CONTENT}}', context())).toBe(
      '{"CamelKey":"value","nested":{"Field":42}}|{"CamelKey":"value","nested":{"Field":42}}|{"message":"Hello","sessionId":"session"}|past',
    );
    expect(renderTemplate('{{inputs.constructor}}', context())).toBe('');
  });
});
