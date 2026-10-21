import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IssueList } from './IssueList.js';

const render = (entries: Parameters<typeof IssueList>[0]['entries']) =>
  renderToStaticMarkup(<IssueList entries={entries} onPick={() => {}} onClose={() => {}} />);

it('makes an issue that names nodes or a connection a button, and one about the whole workflow plain text', () => {
  const html = render([
    { issue: { message: 'Needs a connection' }, targets: { nodeIds: ['a'] } },
    { issue: { message: 'Bad wire' }, targets: { nodeIds: [], edgeId: 'e1' } },
    { issue: { message: 'A loop' }, targets: { nodeIds: [] } },
  ]);
  expect(html.match(/<button type="button">/g)).toHaveLength(2);
  expect(html).toContain('>Needs a connection</button>');
  expect(html).toContain('>Bad wire</button>');
  expect(html).toContain('<span>A loop</span>');
});

it('says so when there are no problems', () => {
  expect(render([])).toContain('No problems found.');
});
