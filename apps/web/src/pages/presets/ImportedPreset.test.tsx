import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { presetSchema, type Preset, type PresetSource } from '@st/shared';
import { PresetEditor } from './PresetEditor.js';
import { EntryList } from './PresetEntryList.js';
import { PresetEntryEditor } from './PresetEntryEditor.js';
import { PresetList } from './PresetList.js';

const source: PresetSource = {
  app: 'sillytavern',
  installPath: '/st',
  user: 'default-user',
  file: 'Main.json',
  hash: 'a'.repeat(64),
  importedAt: '',
};

const preset = (extra: object = {}): Preset =>
  presetSchema.parse({
    id: '8f1fe1a9-3480-4e52-834c-f25d90684d71',
    name: 'Main',
    inputs: [{ id: 'message-id', key: 'message', dataType: 'text' }],
    entries: [
      {
        id: 'system',
        displayName: 'System',
        kind: 'message',
        enabled: true,
        role: 'system',
        content: 'Hi',
        placement: { mode: 'ordered' },
      },
      { id: 'message-slot', displayName: 'Message', kind: 'slot', enabled: true, inputKey: 'message', role: 'user' },
    ],
    source,
    createdAt: '',
    updatedAt: '',
    ...extra,
  });

const editorHtml = (readOnly: boolean, value: Preset = preset()) =>
  renderToStaticMarkup(
    <PresetEditor
      preset={value}
      dirty={false}
      readOnly={readOnly}
      snippetNames={[]}
      onChange={() => {}}
      onSave={() => {}}
      onRevert={() => {}}
      onDuplicate={() => {}}
      selectedEntryId=""
      onSelectEntry={() => {}}
    />,
  );

it('disables the preset name, description, inputs and save for an imported preset', () => {
  const html = editorHtml(true);
  expect(html).toMatch(/aria-label="Preset name"[^>]*disabled=""/);
  expect(html).toMatch(/aria-label="Input key 1"[^>]*disabled=""/);
  expect(html).toMatch(/<button type="button" class="primary" disabled="">Save<\/button>/);
  expect(html).toContain('Duplicate to edit');
  expect(html).toContain('Imported from SillyTavern');
});

it('keeps an editable preset fully enabled', () => {
  const html = editorHtml(false, preset({ source: undefined }));
  expect(html).not.toMatch(/aria-label="Preset name"[^>]*disabled=""/);
  expect(html).not.toContain('Duplicate to edit');
});

it('disables entry changes but keeps entries selectable in a read-only list', () => {
  const html = renderToStaticMarkup(
    <EntryList preset={preset()} readOnly selectedId="" onChange={() => {}} onSelect={() => {}} />,
  );
  expect(html).toMatch(/\+ Message<\/button>/);
  expect(html.match(/aria-label="Delete entry"[^>]*disabled=""/g)).toHaveLength(2);
  expect(html.match(/aria-label="Duplicate entry"[^>]*disabled=""/g)).toHaveLength(2);
  expect(html).not.toContain('Drag to reorder');
  expect(html).not.toContain('sortable-handle');
  expect(html).not.toMatch(/class="preset-entry-select"[^>]*disabled/);
});

it('disables the whole entry field block when read-only', () => {
  const entry = preset().entries[0]!;
  const html = renderToStaticMarkup(<PresetEntryEditor preset={preset()} entry={entry} readOnly onChange={() => {}} />);
  expect(html).toContain('<fieldset disabled="" class="preset-entry-fields">');
});

it('marks imported presets in the list and flags missing sources', () => {
  const html = renderToStaticMarkup(
    <PresetList
      presets={[
        preset(),
        preset({ id: '1c1fe1a9-3480-4e52-834c-f25d90684d71', name: 'Gone', source: { ...source, missing: true } }),
      ]}
      onSelect={() => {}}
      onCreate={() => {}}
      onDuplicate={() => {}}
      onDelete={() => {}}
    />,
  );
  expect(html).toContain('>imported<');
  expect(html).toContain('>source missing<');
});
