import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TextStats } from '@st/shared';
import { ChatMessageView } from './ChatMessageView.js';
import { statItems } from './statItems.js';

const stats: TextStats = { words: 120, mtld: 72.46, slopWords: 3, ngramOverlap: 0.256, recycledSentences: 1 };
const reply = { id: 'a', role: 'assistant' as const, content: 'Hello', createdAt: '' };

it('shows the raw numbers in a fixed order, the overlap as a percentage', () => {
  expect(statItems(stats).map((item) => [item.key, item.value])).toEqual([
    ['words', '120'],
    ['mtld', '72.5'],
    ['slopWords', '3'],
    ['ngramOverlap', '26%'],
    ['recycledSentences', '1'],
  ]);
});

it('shows a dash for a metric that is undefined for the reply', () => {
  const items = statItems({ ...stats, mtld: null, ngramOverlap: null });
  expect(items.find((item) => item.key === 'mtld')?.value).toBe('—');
  expect(items.find((item) => item.key === 'ngramOverlap')?.value).toBe('—');
});

it('labels every item and explains it on hover', () => {
  const html = renderToStaticMarkup(<ChatMessageView message={reply} stats={stats} />);
  expect(html).toContain('aria-label="Text statistics"');
  expect(html).toContain('aria-label="Words: 120"');
  expect(html).toContain('aria-label="Repeated phrasing: 26%"');
  expect(html.match(/<li [^>]*title="[^"]+"/g)).toHaveLength(5);
});

it('shows nothing without stats, on user messages and on streaming rows', () => {
  expect(renderToStaticMarkup(<ChatMessageView message={reply} />)).not.toContain('message-stats');
  expect(renderToStaticMarkup(<ChatMessageView message={{ ...reply, role: 'user' }} stats={stats} />)).not.toContain(
    'message-stats',
  );
  expect(
    renderToStaticMarkup(<ChatMessageView message={{ ...reply, status: 'streaming' }} stats={stats} />),
  ).not.toContain('message-stats');
});
