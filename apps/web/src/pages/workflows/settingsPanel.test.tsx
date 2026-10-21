import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkflowSettingsPanel } from './WorkflowSettingsPanel.js';
import { WorkflowToolbar } from './WorkflowToolbar.js';

const render = (settings: unknown) =>
  renderToStaticMarkup(<WorkflowSettingsPanel settings={settings} onChange={() => {}} onClose={() => {}} />);

it('explains chat settings and offers to add one when there are none', () => {
  const html = render([]);
  expect(html).toContain('aria-label="Chat settings"');
  expect(html).toContain('class="config-panel workflow-settings-panel"');
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
  expect(html).not.toContain('role="alert"');
  expect(html).toMatch(/aria-describedby="[^"]+-options-0"/);
});

it('keeps a declaration it cannot read as a removable read-only row', () => {
  const html = render([
    { key: 'mood', type: 'enum', options: ['a'] },
    { key: 'future', type: 'color', hue: 3 },
  ]);
  expect(html.match(/<fieldset/g)).toHaveLength(2);
  expect(html).toContain('Chat setting #2 (read-only)');
  expect(html).toContain('Chat setting #2 is not valid: its type &quot;color&quot; is not one of');
  expect(html).toContain('aria-label="Remove chat setting #2"');
  expect(html).toContain('&quot;hue&quot;: 3');
});

it('explains a stored value that is not a list and offers to replace it', () => {
  const html = render({ key: 'mood' });
  expect(html).toContain('Chat settings must be a list');
  expect(html).toContain('Replace with an empty list');
  expect(html).not.toContain('Add setting');
});

it('shows the settings toggle in the toolbar with a problem count', () => {
  const props = {
    name: 'W',
    onNameChange: () => {},
    onToggleSettings: () => {},
    issueCount: 0,
    issuesOpen: false,
    onToggleIssues: () => {},
    onValidate: () => {},
    onDuplicate: () => {},
    onSave: () => {},
    onRevert: () => {},
    dirty: false,
  };
  const open = renderToStaticMarkup(<WorkflowToolbar {...props} settingsOpen settingsIssues={2} />);
  expect(open).toContain('aria-pressed="true"');
  expect(open).toContain('Chat settings');
  expect(open).toContain('<span class="issue-count"');
  expect(open).toContain('aria-label="Chat settings (2 problem(s))"');
  expect(open).toContain('<span class="toolbar-toggle-label">Chat settings</span>');
  const closed = renderToStaticMarkup(<WorkflowToolbar {...props} settingsOpen={false} settingsIssues={0} />);
  expect(closed).toContain('aria-pressed="false"');
  expect(closed).not.toContain('issue-count');
});

it('shows the problems toggle in the toolbar with the problem count', () => {
  const props = {
    name: 'W',
    onNameChange: () => {},
    settingsOpen: false,
    settingsIssues: 0,
    onToggleSettings: () => {},
    onToggleIssues: () => {},
    onValidate: () => {},
    onDuplicate: () => {},
    onSave: () => {},
    onRevert: () => {},
    dirty: false,
  };
  const some = renderToStaticMarkup(<WorkflowToolbar {...props} issueCount={3} issuesOpen />);
  expect(some).toContain('aria-label="Problems (3)"');
  expect(some).toContain('<span class="toolbar-toggle-label">Problems</span>');
  expect(some).toContain('<span class="issue-count" aria-hidden="true">3</span>');
  const none = renderToStaticMarkup(<WorkflowToolbar {...props} issueCount={0} issuesOpen={false} />);
  expect(none).toContain('aria-label="Problems"');
  expect(none).not.toContain('issue-count');
});
