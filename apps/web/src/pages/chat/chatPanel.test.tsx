import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Workflow } from '@st/shared';
import { ChatPanel } from './ChatPanel.js';
import { ChatHeader } from './ChatHeader.js';
import { layoutHref } from '../../layout/url.js';

const workflow = (settings?: unknown[]): Workflow => ({
  id: 'w1',
  name: 'Dials',
  nodes: [],
  edges: [],
  createdAt: '',
  updatedAt: '',
  ...(settings ? { settings: settings as Workflow['settings'] } : {}),
});
const render = (target: Workflow | undefined, stored?: Record<string, unknown>) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ChatPanel workflow={target} stored={stored} sessionId="s1" onSave={async () => {}} onClose={() => {}} />
    </MemoryRouter>,
  );

it('says when the workflow declares no settings and links to its editor', () => {
  const html = render(workflow());
  expect(html).toContain('aria-label="Chat panel"');
  expect(html).toContain('>Settings</h3>');
  expect(html).toContain('This chat&#x27;s workflow declares no chat settings.');
  expect(html).toContain(`href="${layoutHref({ wide: 'workflows', wideId: 'w1' })}"`);
  expect(html).toContain('aria-label="Close chat panel"');
  expect(render(undefined)).not.toContain('<a ');
});

it('renders one control per declaration with the stored value or the default, resets and issues', () => {
  const html = render(
    workflow([
      { key: 'volatility', label: 'Volatility', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 },
      { key: 'level', type: 'number', default: 2 },
      { key: 'mood', type: 'enum', options: ['calm', 'tense'], default: 'calm' },
      { key: 'note', type: 'text', multiline: true, description: 'Injected at depth 3' },
      { key: 'title', type: 'text' },
      { key: 'on', type: 'boolean' },
    ]),
    { volatility: 12, mood: 'tense', on: true, ghost: 'kept' },
  );
  expect(html).toContain('Stored value 12 is above max 1; using default 0.3');
  expect(html).toContain('type="range"');
  expect(html).toContain('step="0.05"');
  expect(html).toContain('aria-label="Volatility value"');
  expect(html).toContain('value="0.3"');
  expect(html).toContain('value="2"');
  expect(html).toContain('<option value="tense" selected="">tense</option>');
  expect(html).toContain('<textarea');
  expect(html).toContain('Injected at depth 3');
  expect(html).toContain('checked=""');
  expect(html).toContain('aria-label="Reset Volatility to default"');
  expect(html).toContain('aria-label="Reset mood to default"');
  expect(html).toContain('aria-label="Reset on to default"');
  expect(html).not.toContain('aria-label="Reset level to default"');
  expect(html).not.toContain('aria-label="Reset note to default"');
  expect(html).not.toContain('ghost');
});

it('shows the panel toggle in the chat header, usable while the chat is busy', () => {
  const html = renderToStaticMarkup(
    <ChatHeader
      title="Chat"
      workflowId="w1"
      workflows={[workflow()]}
      characters={[]}
      personas={[]}
      disabled
      onUpdate={async () => {}}
      panelOpen={false}
      onTogglePanel={() => {}}
    />,
  );
  const toggle = html.match(/<button[^>]*aria-label="Chat settings"[^>]*>/)?.[0];
  expect(toggle).toBeDefined();
  expect(toggle).toContain('aria-pressed="false"');
  expect(toggle).toContain('title="Chat settings"');
  expect(toggle).not.toContain('disabled');
});

it('renders a key declared twice once, with its first declaration, as the resolver and server read it', () => {
  const html = render(
    workflow([
      { key: 'mood', type: 'text', default: 'calm' },
      { key: 'mood', type: 'boolean' },
      { key: 'this', type: 'text' },
    ]),
  );
  expect(html.match(/class="chat-setting /g)).toHaveLength(1);
  expect(html).toContain('value="calm"');
  expect(html).not.toContain('type="checkbox"');
});
