import { describe, expect, it } from 'vitest';
import { analyzeTemplate } from './template-analysis.js';

describe('analyzeTemplate', () => {
  it('lists every path reference, including inside blocks, subexpressions and else branches', () => {
    expect(analyzeTemplate('{{#if (eq character.name "aeaze")}}{{input.x}}{{else}}{{persona.name}}{{/if}}')).toEqual({
      references: [
        { expression: '{{character.name}}', name: 'character.name', root: true },
        { expression: '{{input.x}}', name: 'input.x', root: true },
        { expression: '{{persona.name}}', name: 'persona.name', root: true },
      ],
      problems: [],
    });
  });

  it('treats names inside #each bodies as relative to the item, and ../ as the enclosing context', () => {
    expect(
      analyzeTemplate('{{#each input.history}}{{this.role}}{{role}}{{@index}}{{../character.name}}{{/each}}')
        .references,
    ).toEqual([
      { expression: '{{input.history}}', name: 'input.history', root: true },
      { expression: '{{role}}', name: 'role', root: false },
      { expression: '{{../character.name}}', name: 'character.name', root: true },
    ]);
  });

  it('ignores block params and keeps conditionals in the root context', () => {
    expect(analyzeTemplate('{{#each input.history as |message|}}{{message.content}}{{/each}}')).toEqual({
      references: [{ expression: '{{input.history}}', name: 'input.history', root: true }],
      problems: [],
    });
    expect(
      analyzeTemplate('{{#if trigger.message}}{{character.name}}{{/if}}').references.map((ref) => ref.root),
    ).toEqual([true, true]);
  });

  it('never reports helper names, literals or hash keys as references', () => {
    expect(analyzeTemplate('{{#if (and character.name (not persona.name))}}{{! note }}{{/if}}')).toEqual({
      references: [
        { expression: '{{character.name}}', name: 'character.name', root: true },
        { expression: '{{persona.name}}', name: 'persona.name', root: true },
      ],
      problems: [],
    });
  });

  it('reports syntax errors instead of throwing', () => {
    expect(analyzeTemplate('{{#if character.name}}open')).toEqual({
      references: [],
      problems: [expect.stringMatching(/^Template syntax error: /)],
    });
  });

  it('hints at bracket syntax when a numeric segment ends a path', () => {
    expect(analyzeTemplate('{{history.0}}').problems).toEqual([
      expect.stringMatching(
        /^Template syntax error: .*write numeric path segments in brackets, e.g. \{\{history\.\[0\]\}\}\)$/,
      ),
    ]);
    expect(analyzeTemplate('{{history.[0]}}{{history.0.content}}').problems).toEqual([]);
  });

  it('reports partials, decorators, unknown helpers with arguments, and malformed block helpers', () => {
    expect(analyzeTemplate('{{> partial}}').problems).toEqual(['Unsupported template syntax: partials']);
    expect(analyzeTemplate('{{* decorator}}').problems).toEqual(['Unsupported template syntax: decorators']);
    expect(analyzeTemplate('{{format character.name}}').problems).toEqual(['Unknown helper: format']);
    expect(analyzeTemplate('{{#if a b}}x{{/if}}').problems).toEqual(['Block helper #if requires exactly one argument']);
    expect(analyzeTemplate('{{#each}}x{{/each}}').problems).toEqual(['Block helper #each requires an argument']);
  });
});
