import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkflowSetting } from '@st/shared';
import { WorkflowSettingsPanel } from './WorkflowSettingsPanel.js';
import { WorkflowToolbar } from './WorkflowToolbar.js';

const render = (settings: WorkflowSetting[]) =>
  renderToStaticMarkup(<WorkflowSettingsPanel settings={settings} onChange={() => {}} onClose={() => {}} />);

it('explains chat settings and offers to add one when there are none', () => {
  const html = render([]);
  expect(html).toContain('aria-label="Chat settings"');
  expect(html).toContain('No chat settings yet.');
  expect(html).toContain('Add setting');
  expect(html).toContain('{{settings.key}}');
});

it('renders one row per declaration with type-specific fields and inline problems', () => {
  const html = render([
    { key: 'mood', label: 'Mood', type: 'enum', options: [] },
    { key: 'mood', type: 'number', default: 3, max: 1 },
    { key: 'note', type: 'text', default: 'hi', multiline: true },
    { key: 'on', type: 'boolean', default: true },
  ]);
  expect(html).toContain('Chat setting &quot;mood&quot; needs at least one option.');
  expect(html).toContain('More than one chat setting uses the key &quot;mood&quot;; keys must be unique.');
  expect(html).toContain('Chat setting &quot;mood&quot;: the default 3 is above max 1.');
  expect(html).toContain('(first option)');
  expect(html).toContain('<textarea rows="3">hi</textarea>');
  expect(html).toContain('On by default');
  expect(html).toContain('aria-label="Move Mood up"');
  expect(html).toContain('aria-label="Move Mood down"');
  expect(html).toContain('aria-label="Remove Mood"');
  expect(html.match(/<fieldset/g)).toHaveLength(4);
});

it('shows the settings toggle in the toolbar with a problem count', () => {
  const props = {
    name: 'W',
    onNameChange: () => {},
    onToggleSettings: () => {},
    onValidate: () => {},
    onDuplicate: () => {},
    onSave: () => {},
  };
  const open = renderToStaticMarkup(<WorkflowToolbar {...props} settingsOpen settingsIssues={2} />);
  expect(open).toContain('aria-pressed="true"');
  expect(open).toContain('Chat settings');
  expect(open).toContain('<span class="issue-count"');
  const closed = renderToStaticMarkup(<WorkflowToolbar {...props} settingsOpen={false} settingsIssues={0} />);
  expect(closed).toContain('aria-pressed="false"');
  expect(closed).not.toContain('issue-count');
});
