import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SummariesSection } from './SummariesSection.js';
import { buildView, entry, reply, summary } from './test-fixtures.js';
import type { SummarySetView } from '@st/shared';
import type { StoryPanelData } from './useStoryState.js';

const render = (story: StoryPanelData) => renderToStaticMarkup(<SummariesSection story={story} onJump={() => {}} />);
const withSets = (...sets: SummarySetView[]): StoryPanelData => ({
  failed: false,
  view: { ...buildView({ messages: [reply('e1')], entries: [entry('e1')] }), summaries: sets },
});

it('says it is loading, and when loading failed', () => {
  expect(render({ failed: false })).toContain('Loading summaries…');
  const failed = render({ failed: true });
  expect(failed).toContain('Could not load the summaries.');
  expect(failed).not.toContain('Loading summaries');
});

it('explains the feature when the chat has no summaries (or only empty sets)', () => {
  for (const story of [withSets(), withSets({ set: 'main', summaries: [] })]) {
    const html = render(story);
    expect(html).toContain('No summaries yet.');
    expect(html).toContain('Save Summary');
    expect(html).toContain('Memory node');
    expect(html).not.toContain('summary-row');
  }
});

it('lists a valid summary with its range, a valid badge, the collapsible text and a jump button', () => {
  const html = render(withSets({ set: 'main', summaries: [summary()] }));
  expect(html).toContain('>main</h4>');
  expect(html).toContain('messages 21–40 (20)</button>');
  expect(html).toContain('summary-badge valid');
  expect(html).toContain('valid</span>');
  expect(html).toContain('<details class="summary-text"><summary>Summary text</summary><p>They met at the inn.</p>');
  expect(html).toContain('<time dateTime="2026-01-01T10:00:00.000Z">');
  expect(html).not.toContain('<details class="summary-text" open');
  expect(html).not.toContain('summary-why');
});

it('marks an invalid summary and explains that raw messages are used until it is summarized again', () => {
  const html = render(withSets({ set: 'main', summaries: [summary({ valid: false })] }));
  expect(html).toContain('summary-row invalid');
  expect(html).toContain('summary-badge stale');
  expect(html).toContain('invalid</span>');
  expect(html).toContain(
    'A covered message was edited or deleted; raw messages are used until it&#x27;s summarized again.',
  );
});

it('shows how many messages are left of a partly deleted summary, and no button when none are left', () => {
  const html = render(
    withSets({
      set: 'arc',
      summaries: [
        summary({ id: 'a', valid: false, missing: 2, lastIndex: 38 }),
        summary({
          id: 'b',
          valid: false,
          covered: 5,
          missing: 5,
          firstIndex: undefined,
          lastIndex: undefined,
          firstMessageId: undefined,
          lastMessageId: undefined,
        }),
      ],
    }),
  );
  expect(html).toContain('messages 21–38 (18 of 20 left)</button>');
  expect(html).toContain('<span class="summary-chunk">no messages left (0 of 5)</span>');
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain('there is nothing left to summarize');
});

it('lists every set under its own heading', () => {
  const html = render(
    withSets({ set: 'main', summaries: [summary()] }, { set: 'arc', summaries: [summary({ id: 's9' })] }),
  );
  expect(html.indexOf('>main</h4>')).toBeLessThan(html.indexOf('>arc</h4>'));
});
