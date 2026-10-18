import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StorySection } from './StorySection.js';
import { addWrite, buildView, drawWrite, entry, reply, scene, setWrite, userMessage } from './test-fixtures.js';
import type { StoryPanelData } from './useStoryState.js';

const render = (story: StoryPanelData) =>
  renderToStaticMarkup(<StorySection story={story} onJump={() => {}} onJumpMessage={() => {}} />);

const played = () =>
  buildView({
    messages: [userMessage(), reply('e1'), userMessage('u2'), reply('e2'), userMessage('u3'), reply('e3')],
    entries: [
      entry('e1', [setWrite('tension', 5), addWrite('injected', 'e1:note:0', 'a bell', { level: 2 })]),
      entry('e2', [setWrite('tension', 7), addWrite('injected', 'e2:note:0', 'a cart'), setWrite('mood', 'calm')]),
      entry('e3', [
        setWrite('tension', 9),
        addWrite('injected', 'e3:note:0', 'a drum'),
        drawWrite('e3:draw:0', 'resin'),
      ]),
    ],
  });

it('says it is loading, and when loading failed', () => {
  expect(render({ failed: false })).toContain('Loading story state…');
  const failed = render({ failed: true });
  expect(failed).toContain('Could not load the story state.');
  expect(failed).not.toContain('Loading story state');
});

it('explains an empty story and offers the definitions list', () => {
  const html = render({ failed: false, view: buildView({ messages: [reply('e1')], entries: [entry('e1')] }) });
  expect(html).toContain('Nothing has been stored in this chat yet.');
  expect(html).toContain('Open state definitions');
  expect(html).not.toContain('story-keys');
});

it('shows each key with its value and when it was written', () => {
  const html = render({ failed: false, view: played() });
  expect(html).toContain('>scene</h4>');
  expect(html).toContain('<span class="story-key-name">tension</span><span class="story-key-value" title="9">9</span>');
  expect(html).toContain(
    '<span class="story-key-name">mood</span><span class="story-key-value" title="calm">calm</span>',
  );
  expect(html).toContain('written at <button type="button" class="story-turn-link">turn 3</button>');
  expect(html).toContain('written at <button type="button" class="story-turn-link">turn 2</button>');
});

it('says "never written" for keys no turn wrote', () => {
  const html = render({ failed: false, view: played() });
  expect(html).toContain(
    '<span class="story-key-name">quiet</span><span class="story-key-value" title="false">false</span>',
  );
  expect(html).toContain('never written');
});

it('draws a sparkline for a number with history, and none for a boolean or a text', () => {
  const html = render({ failed: false, view: played() });
  const svgs = [...html.matchAll(/<svg[^>]*aria-label="([^"]*)"/g)].map((match) => match[1]);
  expect(svgs).toEqual(['tension over turns: 5, 7, 9']);
  expect(html).toContain('role="img"');
  expect(html).not.toContain('quiet over turns');
  expect(html).not.toContain('place over turns');
});

it('lists a collection newest first with its extra fields', () => {
  const html = render({ failed: false, view: played() });
  expect(html).toContain('3 items');
  const items = html.slice(html.indexOf('class="story-items"'));
  expect(items.indexOf('a drum')).toBeLessThan(items.indexOf('a cart'));
  expect(items.indexOf('a cart')).toBeLessThan(items.indexOf('a bell'));
  expect(html).toContain(' · level 2');
  expect(html).not.toContain('e1:note:0');
  expect(html).toMatch(/<details class="story-list" open="">/);
});

it('collapses a long collection and notes what the cap dropped', () => {
  const capped = { ...scene, keys: { ...scene.keys, injected: { type: 'collection' as const, cap: 6 } } };
  const view = buildView({
    definitions: [capped],
    messages: [reply('e1')],
    entries: [
      entry(
        'e1',
        Array.from({ length: 8 }, (_, i) => addWrite('injected', `e1:note:${i}`, `item ${i}`)),
      ),
    ],
  });
  const html = render({ failed: false, view });
  expect(html).toContain('6 items');
  expect(html).toContain('2 older items dropped by the cap');
  expect(html).toMatch(/<details class="story-list">/);
});

it('shows a stored value that no longer fits as a warning', () => {
  const changed = { ...scene, keys: { ...scene.keys, tension: { type: 'text' as const } } };
  const view = buildView({
    definitions: [changed],
    messages: [reply('e1')],
    entries: [entry('e1', [setWrite('tension', 5)])],
  });
  const html = render({ failed: false, view });
  expect(html).toContain('hint warning story-warning');
  expect(html).toContain('tension: ');
});

it('folds definitions that nothing wrote into one muted line', () => {
  const other = {
    ...scene,
    id: '5d9f7d0e-34a3-4c7b-9b1f-6a3f0f2bb0a2',
    name: 'zeta',
    createdAt: '2026-02-01T00:00:00.000Z',
  };
  const view = buildView({
    definitions: [scene, other],
    messages: [reply('e1')],
    entries: [entry('e1', [setWrite('tension', 5)])],
  });
  const html = render({ failed: false, view });
  expect(html).toContain('Not used in this chat yet: zeta');
  expect(html).not.toContain('>zeta</h4>');
});

it('keeps node memory collapsed, with the node name and its newest items', () => {
  const html = render({ failed: false, view: played() });
  const memory = html.slice(html.indexOf('story-node-memory'));
  expect(memory).toMatch(/^story-node-memory">/);
  expect(memory).toContain('Node memory (1)');
  expect(memory).toContain('Draw #1 (draw)');
  expect(memory).toContain('resin');
});

it('has no node memory section without node writes', () => {
  const view = buildView({ messages: [reply('e1')], entries: [entry('e1', [setWrite('tension', 5)])] });
  expect(render({ failed: false, view })).not.toContain('Node memory');
});

it('has an Edit button per definition that is in use', () => {
  expect(render({ failed: false, view: played() })).toContain('aria-label="Edit state definition scene"');
});

it('keeps showing the last view when a refresh failed', () => {
  const html = render({ failed: true, view: played() });
  expect(html).toContain('Could not refresh');
  expect(html).toContain('>scene</h4>');
});

it('shows a turn that has no reply as plain text, not a link', () => {
  // A turn that ran no Chat Output (replies 0) still counts, but there is nothing in the thread to scroll to.
  const view = buildView({
    messages: [userMessage(), reply('e2')],
    entries: [entry('e1', [setWrite('tension', 5)], 0), entry('e2', [setWrite('mood', 'calm')])],
  });
  const html = render({ failed: false, view });
  expect(html).toContain('written at turn 1</div>');
  expect(html).not.toContain('>turn 1</button>');
  expect(html).toContain('written at <button type="button" class="story-turn-link">turn 2</button>');
});

it('says "written" alone when the turn is no longer numbered', () => {
  const view = played();
  const [first, ...others] = view.definitions;
  const meta = { ...first?.meta.tension, written: true, writtenAtTurn: null } as NonNullable<
    typeof first
  >['meta'][string];
  const html = render({
    failed: false,
    view: { ...view, definitions: [{ ...first!, meta: { ...first!.meta, tension: meta } }, ...others] },
  });
  expect(html).toMatch(/<div class="story-key-meta">written<\/div>/);
});

it('says "1 item" and "1 older item" in the singular', () => {
  const capped = { ...scene, keys: { ...scene.keys, injected: { type: 'collection' as const, cap: 1 } } };
  const view = buildView({
    definitions: [capped],
    messages: [reply('e1')],
    entries: [entry('e1', [addWrite('injected', 'e1:note:0', 'one'), addWrite('injected', 'e1:note:1', 'two')])],
  });
  const html = render({ failed: false, view });
  expect(html).toContain('<summary>1 item</summary>');
  expect(html).toContain('1 older item dropped by the cap');
  expect(html).not.toContain('1 older items');
});

it('keeps the cap note visible while the list is collapsed', () => {
  const capped = { ...scene, keys: { ...scene.keys, injected: { type: 'collection' as const, cap: 6 } } };
  const view = buildView({
    definitions: [capped],
    messages: [reply('e1')],
    entries: [
      entry(
        'e1',
        Array.from({ length: 8 }, (_, i) => addWrite('injected', `e1:note:${i}`, `item ${i}`)),
      ),
    ],
  });
  const html = render({ failed: false, view });
  const details = html.slice(html.indexOf('<details class="story-list"'), html.indexOf('</details>'));
  expect(details).not.toContain('dropped by the cap');
  expect(html.indexOf('dropped by the cap')).toBeGreaterThan(html.indexOf('</details>'));
});

it.each([
  [5, true],
  [6, false],
])('opens a list of %i items: %s', (count, open) => {
  const view = buildView({
    messages: [reply('e1')],
    entries: [
      entry(
        'e1',
        Array.from({ length: count }, (_, i) => addWrite('injected', `e1:note:${i}`, `item ${i}`)),
      ),
    ],
  });
  const html = render({ failed: false, view });
  expect(html.includes('<details class="story-list" open="">')).toBe(open);
});

it('gives an object value its full pretty-printed JSON as the tooltip', () => {
  const flags = { notes: 'n'.repeat(80), nested: { a: 1 } };
  const view = buildView({
    messages: [reply('e1')],
    entries: [entry('e1', [setWrite('flags', flags)])],
  });
  const html = render({ failed: false, view });
  const title = html.match(/<span class="story-key-value" title="([^"]*)">\{/)?.[1] ?? '';
  expect(title.replaceAll('&quot;', '"').replaceAll('&#10;', '\n')).toBe(JSON.stringify(flags, null, 2));
});

it('lists failed after-reply runs, also when nothing is stored and for a turn without a reply', () => {
  const failed = { ...entry('e1', [], 0), postStatus: 'error' as const, postExecutionId: 'p1', postError: 'HTTP 500' };
  const html = render({ failed: false, view: buildView({ messages: [], entries: [failed] }) });
  expect(html).toContain('After-reply steps that failed');
  expect(html).toContain('Turn 1 (no reply)');
  expect(html).toContain('After-reply steps failed: HTTP 500');
  expect(html).toContain('<summary>After-reply run details</summary>');
  // The explanation of an empty story is still there.
  expect(html).toContain('Nothing has been stored in this chat yet.');
});

it('lists them above the stored keys, and not at all when none failed or one was only stopped', () => {
  const messages = [reply('e1'), reply('e2')];
  const failed = { ...entry('e1', [setWrite('tension', 5)]), postStatus: 'error' as const, postError: 'boom' };
  const stopped = { ...entry('e2', [setWrite('tension', 7)]), postStatus: 'stopped' as const, postExecutionId: 'p2' };
  const html = render({ failed: false, view: buildView({ messages, entries: [failed, stopped] }) });
  expect(html.indexOf('After-reply steps that failed')).toBeLessThan(html.indexOf('story-definition'));
  expect(html).toContain('After-reply steps failed: boom');
  // The failed run has no execution id here: no log disclosure; the stopped one is not a failure.
  expect(html).not.toContain('After-reply run details');
  expect(html).not.toContain('Turn 2');
  expect(render({ failed: false, view: played() })).not.toContain('After-reply steps that failed');
});
