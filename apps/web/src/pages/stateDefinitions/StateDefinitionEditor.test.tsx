import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { layoutHref } from '../../layout/url.js';
import { compile } from './definitionCompile.js';
import { changeKeyType, newKeyDraft, toDraft, type DefinitionDraft } from './definitionDraft.js';
import { definition } from './test-fixtures.js';
import { StateDefinitionEditor } from './StateDefinitionEditor.js';
import type { BlockedRename } from './stateDefinitionActions.js';

const saved = toDraft(definition());
const render = (
  props: {
    draft?: DefinitionDraft;
    dirty?: boolean;
    nameLocked?: boolean;
    nameTaken?: string;
    blocked?: BlockedRename;
    saving?: boolean;
  } = {},
) => {
  const draft = props.draft ?? saved;
  return renderToStaticMarkup(
    <MemoryRouter>
      <StateDefinitionEditor
        draft={draft}
        dirty={props.dirty ?? false}
        problems={compile(draft).problems}
        nameLocked={props.nameLocked ?? false}
        nameTaken={props.nameTaken}
        blocked={props.blocked}
        saving={props.saving ?? false}
        onChange={() => {}}
        onSave={() => {}}
        onDelete={() => {}}
        onDuplicate={() => {}}
        onDuplicateAs={() => {}}
        onKeepName={() => {}}
        onBack={() => {}}
      />
    </MemoryRouter>,
  );
};

it('renders the name, the description and one row per key with the fields of its type', () => {
  const html = render();
  expect(html).toContain('value="scene"');
  expect(html).toContain('The scene so far');
  expect(html).toContain('Templates read it as <code>{{state.scene.&lt;key&gt;}}</code>');
  for (let position = 1; position <= 7; position++) expect(html).toContain(`aria-label="Name of key ${position}"`);
  expect(html.match(/class="state-key"/g)).toHaveLength(7);
  // Number: default, min, max. Boolean: select. Enum: options and a default over them. Collection: cap and fields.
  expect(html).toContain('aria-label="Min of key 1"');
  expect(html).toContain('aria-label="Default of key 3"');
  expect(html).toContain('aria-label="Options of key 4"');
  expect(html).toMatch(/<option value="tense" selected="">tense<\/option>/);
  expect(html).toContain('aria-label="Default of key 6"');
  expect(html).toContain('aria-label="Cap of key 7"');
  expect(html).toContain('level:number');
  // An object key's schema is kept but never shown.
  expect(html).not.toContain('x-note');
});

it('notes what a cap does to linked items, neutrally, only while it has a value', () => {
  const warning = 'If items in this list link to messages (such as summaries), a cap drops the oldest';
  expect(render()).toContain(warning);
  expect(render()).not.toMatch(/class="[^"]*warning/);
  const uncapped = { ...saved, keys: saved.keys.map((key) => (key.type === 'collection' ? { ...key, cap: '' } : key)) };
  expect(render({ draft: uncapped })).not.toContain(warning);
});

it('keeps Save off until something changed and nothing is wrong, and says why', () => {
  expect(render()).toMatch(
    /<button type="button" class="primary" disabled="" title="No changes to save">Save<\/button>/,
  );
  expect(render({ dirty: true })).toMatch(/<button type="button" class="primary">Save<\/button>/);
  const broken = { ...saved, keys: [{ ...newKeyDraft(), name: '' }] };
  expect(render({ draft: broken, dirty: true })).toMatch(
    /disabled="" title="Fix the problems shown in the form first">Save</,
  );
  expect(render({ dirty: true, saving: true })).toMatch(/class="primary" disabled="">Save</);
});

it('shows each row’s problems under the row, as alerts', () => {
  const row = { ...changeKeyType(newKeyDraft(), 'number'), name: 'this', min: '9', max: '1' };
  const html = render({ draft: { ...saved, keys: [row] }, dirty: true });
  expect(html).toContain('class="error state-key-problems" role="alert"');
  expect(html).toMatch(/words such as this, true or toString are reserved/);
  expect(html).toContain('aria-invalid="true"');
  const clean = render();
  expect(clean).not.toContain('state-key-problems');
});

it('shows the name problem under the name field', () => {
  expect(render({ draft: { ...saved, name: 'my scene' }, dirty: true })).toMatch(
    /<span class="error" role="alert">Use letters, digits and _/,
  );
  expect(render({ nameTaken: 'A state definition named "scene" already exists.', dirty: true })).toContain(
    'A state definition named &quot;scene&quot; already exists.',
  );
});

it('offers Duplicate… only for a saved definition, and Delete', () => {
  expect(render()).toMatch(/<button type="button">Duplicate…<\/button>/);
  expect(render({ dirty: true })).toMatch(/<button type="button" disabled="" title="[^"]+">Duplicate…<\/button>/);
  expect(render()).toContain('>Delete<');
});

it('explains a refused rename: the server message, the chats as links, and both ways forward', () => {
  const blocked: BlockedRename = {
    name: 'scene2',
    message: '"scene" can\'t be renamed: story state is stored in these chats: Night one.',
    sessions: [{ id: 's1', title: 'Night one' }],
  };
  const html = render({ draft: { ...saved, name: 'scene2' }, dirty: true, nameLocked: true, blocked });
  expect(html).toMatch(/<div class="state-banner" role="alert">/);
  expect(html).toContain('can&#x27;t be renamed');
  expect(html).toContain(`<a href="${layoutHref({ session: 's1' })}"`);
  expect(html).toContain('>Night one</a>');
  expect(html).toContain('Duplicate as &quot;scene2&quot;');
  expect(html).toContain('Keep the current name');
  // The name stays visible but cannot be edited.
  expect(html).toMatch(/<input[^>]*readOnly=""[^>]*value="scene2"|<input[^>]*value="scene2"[^>]*readOnly=""/);
  expect(html).toContain('This name is locked');
  expect(render()).not.toContain('state-banner');
});

it('does not offer Duplicate as while the draft has problems', () => {
  const blocked: BlockedRename = { name: 'x y', message: 'blocked', sessions: [] };
  const html = render({ draft: { ...saved, name: 'x y' }, dirty: true, nameLocked: true, blocked });
  expect(html).toMatch(/<button type="button" disabled="" title="Fix the problems[^"]*">Duplicate as/);
});

it('keeps showing an enum default whose option was removed, flagged as not an option', () => {
  const stale: DefinitionDraft = {
    ...saved,
    keys: saved.keys.map((key) => (key.type === 'enum' ? { ...key, options: 'calm\ntense', default: 'furious' } : key)),
  };
  const html = render({ draft: stale });
  expect(html).toContain('<option value="furious" selected="">(not an option) furious</option>');
  // The problem is shown too, so the stale default is never silently replaced by "First option".
  expect(html).toContain('is not one of its options');
});
