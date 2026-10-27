import { describe, expect, it } from 'vitest';
import { macroRegistry, characterSchema, personaSchema, templateHelperNames } from '@st/shared';
import { createTemplateEnvironment } from './template-helpers.js';
import { renderTemplate, type TemplateContext } from './template.js';

const context = (): TemplateContext => ({
  inputs: { camelKey: 'value', nested: { Field: 42 }, flag: 'false', n: 1, list: [] },
  trigger: { message: 'Hello', sessionId: 'session' },
  history: [{ role: 'user', content: 'past' }],
  character: characterSchema.parse({
    id: 'c',
    name: 'Mira',
    description: 'Friend of {{user}}',
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
    description: '{{char}} fan',
    avatar: false,
    createdAt: '',
    updatedAt: '',
  }),
});

const empty = (): TemplateContext => ({ inputs: {}, trigger: { message: '', sessionId: '' } });

describe('registry-driven templates', () => {
  it('resolves every namespaced character/persona field in the registry', () => {
    const ctx = context();
    for (const macro of macroRegistry.filter((item) => item.category === 'character' || item.category === 'persona')) {
      const raw = ctx[macro.source as 'character' | 'persona']![macro.field!] as string;
      expect(renderTemplate(`{{${macro.name}}}`, ctx)).toBe(renderTemplate(raw, ctx));
    }
  });

  it('resolves aliases and namespaced names, fields, and input keys exactly as written', () => {
    expect(
      renderTemplate('{{char}}|{{user}}|{{description}}|{{personality}}|{{scenario}}|{{persona}}', context()),
    ).toBe('Mira|Alex|Friend of Alex|Kind|Cafe|Mira fan');
    expect(
      renderTemplate(
        '{{character.name}}|{{persona.description}}|{{input.camelKey}}|{{inputs.nested.Field}}|{{trigger.sessionId}}',
        context(),
      ),
    ).toBe('Mira|Mira fan|value|42|session');
  });

  it('renders names that differ in case as unknown, which is empty text', () => {
    expect(renderTemplate('{{CHAR}}|{{User}}|{{Description}}|{{Persona}}', context())).toBe('|||');
    expect(
      renderTemplate(
        '{{CHARACTER.Name}}|{{PERSONA.Description}}|{{INPUT.camelKey}}|{{inputs.Nested.Field}}',
        context(),
      ),
    ).toBe('|||');
  });

  it('renders unknown and removed macros as empty text and empties known missing values', () => {
    expect(
      renderTemplate('{{unknown}}|{{char.name}}|{{user.description}}|{{character.nope}}|{{random::a::b}}', empty()),
    ).toBe('||||');
    expect(
      renderTemplate(
        '{{char}}|{{character.description}}|{{persona.name}}|{{persona}}|{{input.absent}}|{{user}}',
        empty(),
      ),
    ).toBe('|||||User');
  });

  it('expands nested fields and breaks cycles across aliases and persona fields', () => {
    const ctx = context();
    ctx.character!.description = '{{personality}}';
    ctx.character!.personality = '{{character.description}}';
    expect(renderTemplate('{{description}} / {{character.personality}}', ctx)).toBe(' / ');
    ctx.character!.description = '{{persona.description}}';
    ctx.persona!.description = '{{description}}';
    expect(renderTemplate('{{description}}', ctx)).toBe('');
    ctx.persona!.description = '{{character.first_mes}} {{user}}';
    expect(renderTemplate('{{description}}', ctx)).toBe('Hi Alex');
  });

  it('keeps bare node scope names as JSON and nested paths without inherited-property access', () => {
    const json = '{"camelKey":"value","nested":{"Field":42},"flag":"false","n":1,"list":[]}';
    expect(renderTemplate('{{input}}|{{inputs}}|{{trigger}}|{{history.0.content}}', context())).toBe(
      `${json}|${json}|{"message":"Hello","sessionId":"session"}|past`,
    );
    expect(renderTemplate('{{history}}|{{history.[0]}}', context())).toBe(
      '[{"role":"user","content":"past"}]|{"role":"user","content":"past"}',
    );
    expect(renderTemplate('{{inputs.constructor}}', context())).toBe('');
  });

  it('renders a bare persona as its description while keeping persona.name available', () => {
    expect(renderTemplate('{{persona}}|{{persona.name}}', context())).toBe('Mira fan|Alex');
    expect(renderTemplate('{{persona}}|{{persona.name}}', empty())).toBe('|');
  });
});

describe('block helpers', () => {
  it('renders #if and #else with Handlebars truthiness', () => {
    const check = (value: unknown) =>
      renderTemplate('{{#if input.value}}yes{{else}}no{{/if}}', { ...empty(), inputs: { value } });
    expect([null, undefined, '', 0, false, []].map(check)).toEqual(['no', 'no', 'no', 'no', 'no', 'no']);
    expect(['false', 1, [1], {}].map(check)).toEqual(['yes', 'yes', 'yes', 'yes']);
  });

  it('compares with eq, ne, lt, lte, gt and gte using strict, case-sensitive equality', () => {
    const ctx = context();
    expect(renderTemplate('{{#if (eq character.name "Mira")}}a{{/if}}', ctx)).toBe('a');
    expect(renderTemplate('{{#if (eq character.name "mira")}}a{{else}}b{{/if}}', ctx)).toBe('b');
    expect(renderTemplate('{{#if (eq input.n "1")}}a{{else}}b{{/if}}', ctx)).toBe('b');
    expect(renderTemplate('{{#if (eq input.n 1)}}a{{else}}b{{/if}}', ctx)).toBe('a');
    expect(renderTemplate('{{#if (ne character.name "Rin")}}a{{/if}}', ctx)).toBe('a');
    expect(renderTemplate('{{#if (lt input.n 2)}}a{{/if}}{{#if (lte input.n 1)}}b{{/if}}', ctx)).toBe('ab');
    expect(renderTemplate('{{#if (gt input.n 0)}}a{{/if}}{{#if (gte input.n 2)}}b{{else}}c{{/if}}', ctx)).toBe('ac');
  });

  it('combines conditions with and, or and not using the same truthiness as #if', () => {
    const ctx = context();
    expect(renderTemplate('{{#if (and character.name persona.name)}}a{{/if}}', ctx)).toBe('a');
    expect(renderTemplate('{{#if (and character.name input.missing)}}a{{else}}b{{/if}}', ctx)).toBe('b');
    expect(renderTemplate('{{#if (or "" input.missing input.list)}}a{{else}}b{{/if}}', ctx)).toBe('b');
    expect(renderTemplate('{{#if (or "" input.missing input.n)}}a{{/if}}', ctx)).toBe('a');
    expect(renderTemplate('{{#if (not input.missing)}}a{{/if}}', ctx)).toBe('a');
    expect(renderTemplate('{{#if (not input.flag)}}a{{else}}b{{/if}}', ctx)).toBe('b');
  });

  it('iterates raw history in #each with @index, @first and @last', () => {
    const ctx = {
      ...context(),
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'yo' },
      ],
    };
    expect(
      renderTemplate(
        '{{#each history}}{{@index}}{{#if @first}}F{{/if}}{{#if @last}}L{{/if}}:{{this.role}}={{this.content}}{{#unless @last}};{{/unless}}{{/each}}',
        ctx,
      ),
    ).toBe('0F:user=hi;1L:assistant=yo');
  });

  it('renders the else branch or nothing for #each over a missing or non-array value', () => {
    const ctx = context();
    expect(renderTemplate('{{#each input.missing}}x{{else}}none{{/each}}', ctx)).toBe('none');
    expect(renderTemplate('{{#each input.n}}x{{else}}none{{/each}}', ctx)).toBe('none');
    expect(renderTemplate('{{#each input.missing}}x{{/each}}', ctx)).toBe('');
    expect(renderTemplate('{{#each input.list}}x{{else}}empty{{/each}}', ctx)).toBe('empty');
  });

  it('strips comments and standalone block lines', () => {
    expect(renderTemplate('a{{! hidden }}b\n{{#if character.name}}\nline\n{{/if}}\nc', context())).toBe('ab\nline\nc');
  });

  it('renders blocks inside character and persona fields', () => {
    const ctx = context();
    ctx.character!.description = '{{#if (eq persona.name "Alex")}}Alex-only{{/if}}';
    expect(renderTemplate('{{description}}', ctx)).toBe('Alex-only');
  });

  it('keeps a template with a syntax error or unsupported syntax unchanged', () => {
    for (const template of [
      '{{#if character.name}}open',
      '{{input.foo.constructor()}}',
      '{{> partial}}',
      '{{foo bar}}',
    ]) {
      expect(renderTemplate(template, context())).toBe(template);
    }
    expect(renderTemplate('{{input.camelKey}} {{#if}}x{{/if}}', context())).toBe('{{input.camelKey}} {{#if}}x{{/if}}');
  });

  it('registers the comparison helpers and no stock log helper', () => {
    const environment = createTemplateEnvironment();
    for (const name of templateHelperNames) expect(environment.helpers[name], name).toBeDefined();
    expect(environment.helpers.log).toBeUndefined();
  });
});

describe('snippets', () => {
  const withSnippets = (snippets: Record<string, string>): TemplateContext => ({
    ...context(),
    settings: { mood: 'calm' },
    snippets,
  });

  it('renders a snippet with the context of the template using it, nested snippets included', () => {
    const ctx = withSnippets({
      tone: '{{#if (eq settings.mood "calm")}}Speak softly to {{user}}.{{else}}Shout.{{/if}}',
      intro: '{{char}}: {{snippets.tone}}',
    });
    expect(renderTemplate('{{snippets.intro}}', ctx)).toBe('Mira: Speak softly to Alex.');
    expect(renderTemplate('{{snippets.tone}} {{input.camelKey}}', ctx)).toBe('Speak softly to Alex. value');
  });

  it('renders unknown snippets and cycles as empty text, and works inside character fields', () => {
    const ctx = withSnippets({ loop: 'a{{snippets.back}}', back: 'b{{snippets.loop}}', who: 'Mira' });
    expect(renderTemplate('[{{snippets.missing}}]', ctx)).toBe('[]');
    expect(renderTemplate('{{snippets.loop}}', ctx)).toBe('ab');
    const card = { ...ctx, character: { ...ctx.character!, description: 'I am {{snippets.who}}' } };
    expect(renderTemplate('{{description}}', card)).toBe('I am Mira');
  });
});
