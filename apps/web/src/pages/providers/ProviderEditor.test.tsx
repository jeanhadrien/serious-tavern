import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { builtInProviders } from '@st/shared';
import { ProviderEditor } from './ProviderEditor.js';
import { toDraft } from './providerDraft.js';

const draft = toDraft({ ...builtInProviders[0]!, builtIn: true });
const render = (props: { readOnly?: boolean; dirty?: boolean; errors?: string[] }) =>
  renderToStaticMarkup(
    <ProviderEditor
      draft={draft}
      dirty={props.dirty ?? false}
      readOnly={props.readOnly ?? false}
      errors={props.errors ?? []}
      secretNames={['openrouter', 'deepseek']}
      onChange={() => {}}
      onSave={() => {}}
      onDelete={() => {}}
      onDuplicate={() => {}}
      onBack={() => {}}
    />,
  );

it('opens the built-in provider read-only, with Duplicate as the only action', () => {
  const html = render({ readOnly: true });
  expect(html).toMatch(/<fieldset class="provider-form" disabled="">/);
  expect(html).toContain('Built-in provider, read-only');
  expect(html).toMatch(/<button type="button">Duplicate<\/button>/);
  expect(html).not.toContain('>Save<');
  expect(html).not.toContain('>Delete<');
});

it('offers save and delete for a user provider, and the known secret names', () => {
  const html = render({ dirty: true });
  expect(html).toContain('<fieldset class="provider-form">');
  expect(html).not.toContain('Built-in provider');
  expect(html).toMatch(/<button type="button" class="primary">Save<\/button>/);
  expect(html).toContain('>Delete<');
  expect(html).toContain('<option value="deepseek">');
  // Duplicate copies the saved record, so it waits for the draft to be saved.
  expect(html).toMatch(/<button type="button" disabled="" title="[^"]+">Duplicate<\/button>/);
});

it('shows the problems found on save', () => {
  const html = render({ errors: ['YAML overrides.0.match: Required'] });
  expect(html).toContain('role="alert"');
  expect(html).toContain('YAML overrides.0.match: Required');
});
