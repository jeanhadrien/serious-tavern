import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StorySection } from './StorySection.js';
import { addWrite, buildView, drawWrite, entry, reply, scene, setWrite, userMessage } from './fixtures.js';
import type { StoryPanelData } from './useStoryState.js';

const render = (story: StoryPanelData) => renderToStaticMarkup(<StorySection story={story} onJump={() => {}} />);

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
