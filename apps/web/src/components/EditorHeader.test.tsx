import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorHeader, type HeaderActions } from './EditorHeader.js';

const noop = () => {};
const all: HeaderActions = {
  save: { onClick: noop },
  revert: { onClick: noop },
  duplicate: { onClick: noop },
  remove: { onClick: noop },
};
const render = (props: { dirty?: boolean; actions?: HeaderActions; extra?: string; note?: string }) =>
  renderToStaticMarkup(
    <EditorHeader
      title="Ann"
      back={{ label: 'Back to people', onClick: noop }}
      dirty={props.dirty ?? false}
      actions={props.actions ?? all}
      extra={props.extra && <button type="button">{props.extra}</button>}
      note={props.note && <p>{props.note}</p>}
    />,
  );

const order = (html: string, labels: string[]) => labels.map((label) => html.indexOf(`>${label}<`));

it('shows the back button, the name and the unsaved marker only while dirty', () => {
  const clean = render({});
  expect(clean).toContain('aria-label="Back to people"');
  expect(clean).toContain('<h1>Ann</h1>');
  expect(clean).not.toContain('Unsaved changes');
  expect(render({ dirty: true })).toContain('<span class="dirty-dot">Unsaved changes</span>');
});

it('lists the actions in the fixed order, extra first', () => {
  const positions = order(render({ dirty: true, extra: 'Validate' }), [
    'Validate',
    'Save',
    'Revert',
    'Duplicate',
    'Delete',
  ]);
  expect(positions.every((at) => at >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});

it('shows Revert only while dirty', () => {
  expect(render({})).not.toContain('>Revert<');
  expect(render({ dirty: true })).toContain('>Revert<');
});

it('leaves out an action that is not given, and keeps disabled states, titles and labels', () => {
  const html = render({
    dirty: true,
    actions: { duplicate: { onClick: noop, disabled: true, title: 'Save first', label: 'Duplicate…' } },
  });
  expect(html).not.toContain('>Save<');
  expect(html).not.toContain('>Delete<');
  expect(html).toMatch(/<button type="button" disabled="" title="Save first">Duplicate…<\/button>/);
});

it('marks Save as the primary button and renders the note after the header', () => {
  const html = render({ note: 'Read-only' });
  expect(html).toMatch(/<button type="button" class="primary">Save<\/button>/);
  expect(html.indexOf('Read-only')).toBeGreaterThan(html.indexOf('>Delete<'));
});

it('accepts a node as the title (a name input) and has no back button without `back`', () => {
  const html = renderToStaticMarkup(
    <EditorHeader title={<input aria-label="Name" />} dirty={false} actions={{ save: { onClick: noop } }} />,
  );
  expect(html).toContain('aria-label="Name"');
  expect(html).not.toContain('<h1>');
  expect(html).not.toContain('icon-button');
  expect(html).not.toContain('editor-header-stacked');
});
