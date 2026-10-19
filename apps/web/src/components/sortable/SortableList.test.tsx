import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SortableList } from './SortableList.js';

const render = (props: { disabled?: boolean } = {}) =>
  renderToStaticMarkup(
    <SortableList
      items={['alpha', 'beta', 'gamma']}
      getId={(item) => item}
      label={(item) => item.toUpperCase()}
      onMove={() => {}}
      renderItem={(item, row) => (
        <>
          {row.handle}
          <span>{item}</span>
          <button type="button" disabled={!row.moveUp}>{`up ${row.index}`}</button>
          <button type="button" disabled={!row.moveDown}>{`down ${row.index}`}</button>
        </>
      )}
      {...props}
    />,
  );

it('renders each item through renderItem with a labelled handle', () => {
  const html = render();
  for (const name of ['ALPHA', 'BETA', 'GAMMA']) {
    expect(html).toContain(`aria-label="Drag to reorder ${name}"`);
    expect(html).toContain(`title="Drag to reorder ${name}"`);
  }
  for (const item of ['alpha', 'beta', 'gamma']) expect(html).toContain(`<span>${item}</span>`);
  expect(html.match(/class="[^"]*sortable-handle/g)).toHaveLength(3);
});

it('gives rows move actions that are missing at the ends', () => {
  const html = render();
  expect(html).toMatch(/<button type="button" disabled="">up 0<\/button>/);
  expect(html).toMatch(/<button type="button">up 1<\/button>/);
  expect(html).toMatch(/<button type="button">down 1<\/button>/);
  expect(html).toMatch(/<button type="button" disabled="">down 2<\/button>/);
});

it('renders no handles and no move actions when disabled', () => {
  const html = render({ disabled: true });
  expect(html).not.toContain('Drag to reorder');
  expect(html).not.toContain('sortable-handle');
  expect(html).toMatch(/<button type="button" disabled="">up 1<\/button>/);
  expect(html).toMatch(/<button type="button" disabled="">down 1<\/button>/);
  expect(html).toContain('<span>beta</span>');
});

it('puts the list and its rows in the elements asked for', () => {
  const html = renderToStaticMarkup(
    <SortableList
      as="ol"
      rowAs="li"
      className="list"
      rowClassName={(item) => `row-${item}`}
      items={['a']}
      getId={(item) => item}
      label={(item) => item}
      onMove={() => {}}
      renderItem={(item) => item}
    />,
  );
  expect(html).toMatch(/<ol class="list"><li class="sortable-row row-a"/);
});
