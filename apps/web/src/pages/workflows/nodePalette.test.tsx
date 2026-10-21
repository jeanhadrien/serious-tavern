import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NodeTypeDescriptor } from '@st/shared';
import { NodePalette } from './NodePalette.js';

const descriptor = (type: string, category: string): NodeTypeDescriptor => ({
  type,
  label: type,
  description: '',
  category,
  dynamicPorts: false,
  inputs: [],
  outputs: [],
  configSchema: {},
  defaultConfig: {},
});

it('groups categories with several types in a disclosure, open by default, and leaves a lone type a plain button', () => {
  const html = renderToStaticMarkup(
    <NodePalette
      types={[descriptor('llm', 'AI'), descriptor('output', 'Chat'), descriptor('input', 'Chat')]}
      onAdd={() => {}}
    />,
  );
  expect(html.match(/<details/g)).toHaveLength(1);
  expect(html).toContain('<summary>Chat</summary>');
  expect(html).toMatch(/<details[^>]* open=""/);
  // The lone AI type sits at group level with its category as caption, outside the disclosure.
  expect(html).toContain('<small>AI</small>llm +');
  expect(html.indexOf('llm +')).toBeLessThan(html.indexOf('<details'));
  // Types of a group follow the label order, without the category caption.
  expect(html.indexOf('input +')).toBeLessThan(html.indexOf('output +'));
  expect(html).not.toContain('<small>Chat</small>');
});
