import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ReplyEntry, ReplyPlan, Workflow } from '@st/shared';
import { layoutHref } from '../../../layout/url.js';
import { ReplySection } from './ReplySection.js';
import { SettingsSection } from './SettingsSection.js';

const workflow = (id: string, name: string, settings?: unknown[]): Workflow => ({
  id,
  name,
  nodes: [],
  edges: [],
  createdAt: '',
  updatedAt: '',
  ...(settings ? { settings: settings as Workflow['settings'] } : {}),
});
const entry = (workflowId: string, enabled = true): ReplyEntry => ({ workflowId, enabled });
const all = [workflow('a', 'Narrator'), workflow('b', 'Memory'), workflow('c', 'Aside')];
const render = (stored: ReplyEntry[], workflows = all, plan?: ReplyPlan) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ReplySection sessionId="s1" workflows={workflows} stored={stored} plan={plan} onSave={async () => true} />
    </MemoryRouter>,
  );

describe('On reply plan hints', () => {
  const plan: ReplyPlan = {
    entries: [
      { workflowId: 'a', waitsFor: [] },
      { workflowId: 'b', waitsFor: ['a'], reason: 'reads the chat history Narrator writes' },
      { workflowId: 'c', waitsFor: [] },
    ],
  };

  it('says under each row whether it waits, with the reason as the title', () => {
    const html = render([entry('a'), entry('b'), entry('c')], all, plan);
    expect(html).toContain(
      '<span class="reply-hint" title="reads the chat history Narrator writes">Waits for Narrator</span>',
    );
    expect(html).toContain('>Runs alongside the ones above</span>');
    // The first row has nothing above it.
    expect(html.match(/class="reply-hint/g)).toHaveLength(2);
  });

  it('shows no hint before the plan has loaded', () => {
    expect(render([entry('a'), entry('b')])).not.toContain('reply-hint');
  });

  it('marks a workflow that cannot run as a problem', () => {
    const html = render([entry('a'), entry('b')], all, {
      entries: [
        { workflowId: 'a', waitsFor: [] },
        { workflowId: 'b', waitsFor: [], reason: 'This workflow is invalid, so it cannot run yet.' },
      ],
    });
    expect(html).toContain('class="reply-hint reply-hint-problem"');
  });
});

describe('On reply', () => {
  it('lists the workflows in order, each a link to its editor with a switch', () => {
    const html = render([entry('b'), entry('a', false)]);
    expect(html.indexOf('>Memory</a>')).toBeLessThan(html.indexOf('>Narrator</a>'));
    expect(html).toContain(`href="${layoutHref({ wide: 'workflows', wideId: 'b' })}"`);
    expect(html).toMatch(/<input type="checkbox" aria-label="Run Memory on reply"[^>]*checked/);
    expect(html).not.toMatch(/aria-label="Run Narrator on reply"[^>]*checked/);
    expect(html).toContain('reply-row reply-row-off');
  });

  it('gives each row reorder and remove buttons with names, and no remove on the only row', () => {
    const html = render([entry('b'), entry('a')]);
    for (const label of [
      'Drag to reorder Memory',
      'Move Memory down',
      'Move Narrator up',
      'Remove Memory from the list',
      'Remove Narrator from the list',
    ])
      expect(html).toContain(`aria-label="${label}"`);
    // The first row cannot go up, the last cannot go down.
    expect(html).toMatch(/aria-label="Move Memory up"[^>]*disabled/);
    expect(html).toMatch(/aria-label="Move Narrator down"[^>]*disabled/);
    expect(render([entry('a')])).not.toContain('Remove Narrator');
  });

  it('offers only the workflows that are not listed in the picker', () => {
    const picker = render([entry('b')]).match(/<select aria-label="Add workflow".*?<\/select>/)?.[0] ?? '';
    expect(picker).toContain('>Narrator</option>');
    expect(picker).toContain('>Aside</option>');
    expect(picker).not.toContain('>Memory</option>');
    expect(render([entry('a'), entry('b'), entry('c')])).not.toContain('Add workflow');
  });

  it('shows an unknown workflow as text that can still be removed', () => {
    const html = render([entry('gone'), entry('a')]);
    expect(html).toContain('Unknown workflow (gone)');
    expect(html).not.toContain(`wideId`);
    expect(html).not.toContain('href="/?wide=workflow:gone"');
    expect(html).toContain('aria-label="Remove Unknown workflow (gone) from the list"');
  });

  it('says so when every workflow is off', () => {
    expect(render([entry('a', false)])).toContain('Every workflow is off');
    expect(render([entry('a', false), entry('b')])).not.toContain('Every workflow is off');
  });
});

describe('Settings of a list', () => {
  const dial = { key: 'mood', type: 'text', default: 'calm' };
  const other = { key: 'level', type: 'number', default: 2 };
  const renderSettings = (workflows: Workflow[], stored?: Record<string, unknown>) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <SettingsSection workflows={workflows} stored={stored} sessionId="s1" onSave={async () => {}} />
      </MemoryRouter>,
    );

  it('shows the union of the listed workflows, the first declaration of a key winning', () => {
    const html = renderSettings([
      workflow('a', 'Narrator', [dial]),
      workflow('b', 'Memory', [{ key: 'mood', type: 'boolean' }, other]),
    ]);
    expect(html.match(/class="chat-setting /g)).toHaveLength(2);
    expect(html).toContain('value="calm"');
    expect(html).toContain('value="2"');
    expect(html).not.toContain('chat-setting-toggle');
  });

  it('says none of the workflows declares settings, without picking one to link to', () => {
    const html = renderSettings([workflow('a', 'Narrator'), workflow('b', 'Memory')]);
    expect(html).toContain('No workflow of this chat declares chat settings.');
    expect(html).not.toContain('<a ');
  });

  it('names the workflows whose declarations are broken', () => {
    const html = renderSettings([
      workflow('a', 'Narrator', [dial]),
      workflow('b', 'Memory', [{ key: '', type: 'boolean' }]),
    ]);
    expect(html).toContain('Chat settings of some of this chat&#x27;s workflows have problems');
    expect(html).toContain(`href="${layoutHref({ wide: 'workflows', wideId: 'b' })}"`);
    expect(html).not.toContain(`href="${layoutHref({ wide: 'workflows', wideId: 'a' })}"`);
  });
});
