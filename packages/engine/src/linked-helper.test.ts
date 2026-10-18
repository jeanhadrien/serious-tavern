import { describe, expect, it } from 'vitest';
import { analyzeTemplate, templateHelperNames, withItemLinks, type StateSnapshot } from '@st/shared';
import { renderTemplate } from './template.js';
import { createTemplateEnvironment } from './template-helpers.js';
import { idRange, linkedItem, memoryDefinition, messagesOf, withEdit } from './test-links.js';
import { snapshotOf } from './test-state.js';

const history = messagesOf(60);
const s1 = linkedItem(history, idRange(1, 20), 's1');
const s2 = linkedItem(history, idRange(21, 40), 's2');
const s3 = linkedItem(history, idRange(41, 60), 's3');

/** A snapshot whose `memory.summaries` holds `items` (newest first) as the server computes them for `messages`. */
function stateWith(items: object[], messages = history) {
  const snapshot: StateSnapshot = snapshotOf([memoryDefinition]);
  const view = snapshot.keys[memoryDefinition.id]!.summaries!;
  view.value = withItemLinks(items as { id: string }[], messages);
  return snapshot;
}
const render = (template: string, state: StateSnapshot) =>
  renderTemplate(template, {
    inputs: {},
    trigger: { message: '', sessionId: 's' },
    state: {
      values: Object.fromEntries([
        [
          'memory',
          Object.fromEntries(Object.entries(state.keys[memoryDefinition.id]!).map(([key, view]) => [key, view.value])),
        ],
      ]),
    },
  });
const TEMPLATE = '{{#each (linked state.memory.summaries)}}[{{id}}]{{/each}}';

describe('the linked template helper', () => {
  it('is registered, and listed with the others', () => {
    expect(templateHelperNames).toContain('linked');
    expect(createTemplateEnvironment().helpers.linked).toBeTypeOf('function');
  });

  it('is known to template analysis: no unknown-helper problem, and the key is still a reference', () => {
    const analysis = analyzeTemplate(TEMPLATE);
    expect(analysis.problems).toEqual([]);
    expect(analysis.references[0]).toMatchObject({ name: 'state.memory.summaries', root: true });
  });

  it('repeats the intact linked items in chat order, whatever order the collection holds them in', () => {
    expect(render(TEMPLATE, stateWith([s3, s1, s2]))).toBe('[s1][s2][s3]');
    // A summary of an earlier chunk redone later sits between the others.
    const redone = linkedItem(history, idRange(21, 40), 's2b');
    expect(render(TEMPLATE, stateWith([redone, s3, s1]))).toBe('[s1][s2b][s3]');
  });

  it('leaves out broken items and keeps one of two items that link the same messages', () => {
    expect(render(TEMPLATE, stateWith([s3, s2, s1], withEdit(history, 'm25', 'edited')))).toBe('[s1][s3]');
    expect(render(TEMPLATE, stateWith([s3, s2, s1], withEdit(history, 'm25')))).toBe('[s1][s3]');
    const twin = linkedItem(history, idRange(21, 40), 'twin');
    expect(render(TEMPLATE, stateWith([twin, s3, s2, s1]))).toBe('[s1][twin][s3]');
  });

  it('reads the item fields as usual inside the block', () => {
    const state = stateWith([s2, s1]);
    expect(render('{{#each (linked state.memory.summaries)}}{{text}};{{/each}}', state)).toBe(
      'summary of m1-m20;summary of m21-m40;',
    );
    expect(render('{{#each (linked state.memory.summaries)}}{{this.link.status}}{{/each}}', state)).toBe(
      'intactintact',
    );
  });

  it('takes the else branch when there is nothing', () => {
    const empty = '{{#each (linked state.memory.summaries)}}x{{else}}none{{/each}}';
    expect(render(empty, stateWith([]))).toBe('none');
    expect(render(empty, stateWith([s1], history.slice(30)))).toBe('none');
  });

  it.each(['state.memory.note', 'state.memory.missing', 'state.nothing', 'input.x', '"text"', '5'])(
    'gives an empty list for %s, which is not a collection of items',
    (value) => {
      expect(render(`{{#each (linked ${value})}}x{{else}}none{{/each}}`, stateWith([s1]))).toBe('none');
    },
  );

  it('can be used with if, and does not change the collection itself', () => {
    const state = stateWith([s2, s1]);
    expect(render('{{#if (linked state.memory.summaries)}}some{{else}}none{{/if}}', state)).toBe('some');
    expect(render('{{#each state.memory.summaries}}[{{id}}]{{/each}}', state)).toBe('[s2][s1]');
  });
});
