import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CollectionEditor } from './CollectionEditor.js';
import { newEntry, type CollectionDraft } from './collectionDraft.js';

const draft: CollectionDraft = {
  name: 'Northern Wastes',
  description: 'World lore',
  entries: [
    { ...newEntry(), title: 'The Salt Inn', text: 'The inn by the river.', keywords: 'salt inn, Borin', level: '2' },
    { ...newEntry(), text: 'resin after rain', tags: 'forest', enabled: false },
  ],
};
const noop = () => {};
const render = (props: { dirty?: boolean; errors?: string[]; selected?: number }) =>
  renderToStaticMarkup(
    <CollectionEditor
      draft={draft}
      dirty={props.dirty ?? false}
      errors={props.errors ?? []}
      selected={props.selected}
      onChange={noop}
      onSelect={noop}
      onEntryChange={noop}
      onAddEntry={noop}
      onRemoveEntry={noop}
      onMoveEntry={noop}
      onSave={noop}
      onDiscard={noop}
      onDelete={noop}
      onBack={noop}
    />,
  );

it('shows the name, the description and one row per entry with its badges', () => {
  const html = render({});
  expect(html).toContain('<h1>Northern Wastes</h1>');
  expect(html).toContain('World lore');
  expect(html).toContain('Entries (2)');
  expect(html).toContain('The Salt Inn');
  expect(html).toContain('resin after rain');
  for (const badge of ['L2', '2 keywords', '1 tag', 'disabled']) expect(html).toContain(`>${badge}</small>`);
  // Collapsed: no entry form.
  expect(html).not.toContain('<textarea rows="6"');
});

it('expands the selected entry into its fields', () => {
  const html = render({ selected: 0 });
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('value="salt inn, Borin"');
  expect(html).toMatch(/<option value="2" selected="">2<\/option>/);
  expect(html).toContain('0 = never drawn');
});

it('saves only when dirty and offers Discard then', () => {
  const clean = render({});
  expect(clean).toMatch(/<button type="button" class="primary" disabled="">Save<\/button>/);
  expect(clean).not.toContain('>Discard<');
  const dirty = render({ dirty: true });
  expect(dirty).toMatch(/<button type="button" class="primary">Save<\/button>/);
  expect(dirty).toContain('>Discard<');
  expect(dirty).toContain('Unsaved');
});

it('labels its icon buttons and shows problems found on save', () => {
  const html = render({ errors: ['Entry 2: weight must be a number of 0 or more'] });
  for (const label of ['Back to collections', 'Move entry up', 'Move entry down', 'Delete entry'])
    expect(html).toContain(`aria-label="${label}" title="${label}"`);
  expect(html).toContain('role="alert"');
  expect(html).toContain('Entry 2: weight must be a number of 0 or more');
});
