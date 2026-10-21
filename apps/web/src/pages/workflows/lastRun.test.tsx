import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LastRun } from './LastRun.js';
import type { LastRunIO } from './lastRunIO.js';

const nameOf = (id: string) => (id === 'cond' ? 'Condition #1' : undefined);
const render = (io: LastRunIO | undefined, stale = false) =>
  renderToStaticMarkup(<LastRun io={io} stale={stale} nameOf={nameOf} />);

it('is collapsed, and shows the inputs, the output and the status', () => {
  const html = render({
    status: 'completed',
    inputs: [
      { port: 'value', label: 'Value', arrived: true, value: 'hello' },
      { port: 'extra', label: 'Extra', arrived: false },
    ],
    output: { out: 'done' },
  });
  expect(html).toContain('<details class="last-run">');
  expect(html).not.toContain('<details class="last-run" open');
  expect(html).toContain('Last run · completed');
  expect(html).toContain('<pre>hello</pre>');
  expect(html).toContain('Nothing arrived.');
  expect(html).toContain('&quot;out&quot;: &quot;done&quot;');
});

it('says why a node was skipped, with the name of the node it came from', () => {
  const html = render({
    status: 'skipped',
    skip: { reason: 'source-skipped', by: 'cond' },
    inputs: [],
  });
  expect(html).toContain('A required input comes from &quot;Condition #1&quot;, which was skipped.');
});

it('cuts a long value and offers the whole of it', () => {
  const html = render({
    status: 'completed',
    inputs: [{ port: 'v', label: 'V', arrived: true, value: 'x'.repeat(2000) }],
  });
  expect(html).toContain('…</pre>');
  expect(html).toContain('Show all');
  expect(html).toContain('x'.repeat(2000));
});

it('greys the panel with a note when the workflow changed since the run', () => {
  const html = render({ status: 'completed', inputs: [] }, true);
  expect(html).toContain('class="last-run stale"');
  expect(html).toContain('The workflow changed since this run');
});

it('says so when the run never reached the node', () => {
  expect(render(undefined)).toContain('no run of this workflow that reached this node');
});
