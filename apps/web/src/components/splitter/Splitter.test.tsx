import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Splitter } from './Splitter.js';

it('renders a focusable separator with its ARIA attributes', () => {
  const html = renderToStaticMarkup(
    <Splitter label="Resize chat panel" value={320.4} min={260} max={640} onChange={() => {}} />,
  );
  expect(html).toContain('role="separator"');
  expect(html).toContain('aria-orientation="vertical"');
  expect(html).toContain('aria-label="Resize chat panel"');
  expect(html).toContain('aria-valuenow="320"');
  expect(html).toContain('aria-valuemin="260"');
  expect(html).toContain('aria-valuemax="640"');
  expect(html).toContain('tabindex="0"');
});

it('reports a horizontal orientation and takes an extra class', () => {
  const html = renderToStaticMarkup(
    <Splitter label="Resize" value={100} orientation="horizontal" className="x" onChange={() => {}} />,
  );
  expect(html).toContain('aria-orientation="horizontal"');
  expect(html).toContain('class="splitter x"');
});
