import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { NodeConfigPanel } from '@st/node-ui';
import { nodeTypeDescriptorSchema } from '@st/shared';
import { WorkflowConfigPanel } from './WorkflowConfigPanel.js';

const descriptor = (type: string, defaultConfig: Record<string, unknown>) =>
  nodeTypeDescriptorSchema.parse({
    type,
    label: type,
    description: type,
    category: 'Lore',
    dynamicPorts: false,
    inputs: [],
    outputs: [],
    configSchema: {},
    defaultConfig,
  });
const recall = descriptor('recall', {
  collectionIds: [],
  scanMessages: 4,
  caseSensitive: false,
  wholeWords: true,
  maxEntries: 5,
  maxChars: 0,
  separator: '\n\n',
});
const draw = descriptor('draw', {
  collectionIds: [],
  count: 1,
  requireTags: [],
  anyTags: [],
  excludeTags: [],
  useWeights: true,
});
const collections = [
  { id: 'lore', name: 'Northern Wastes' },
  { id: 'deck', name: 'Forest deck' },
  { id: 'spare', name: 'Spare' },
];

it('renders the Recall panel with the picked collections in order, unknown ids and routed links', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <WorkflowConfigPanel
        current={{
          id: 'recall',
          position: { x: 0, y: 0 },
          data: { descriptor: recall, config: { collectionIds: ['deck', 'gone', 'lore'] }, name: 'Recall #1 (recall)' },
        }}
        presets={[]}
        characters={[]}
        providersList={[]}
        collections={collections}
        updateConfig={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />
    </MemoryRouter>,
  );
  expect(html.indexOf('Forest deck')).toBeLessThan(html.indexOf('Unknown collection (gone)'));
  expect(html.indexOf('Unknown collection (gone)')).toBeLessThan(html.indexOf('>Northern Wastes<'));
  expect(html).toContain('href="/collections?id=deck"');
  expect(html).not.toContain('href="/collections?id=gone"');
  expect(html.match(/Edit ↗/g)).toHaveLength(2);
  // Only the collection not yet picked can be added.
  expect(html).toContain('<option value="spare">Spare</option>');
  expect(html).not.toContain('<option value="lore">');
  expect(html).toContain('aria-label="Move Forest deck down"');
  expect(html).toContain('aria-label="Remove Unknown collection (gone)"');
  // Defaults fill the fields the stored config leaves out; the separator is shown escaped.
  expect(html).toContain('value="4"');
  expect(html).toContain('value="5"');
  expect(html).toContain('value="\\n\\n"');
  expect(html).toMatch(/<input type="checkbox" checked=""\/>Whole words only/);
});

it('renders the Draw panel with tag lists, level filters and weights', () => {
  const html = renderToStaticMarkup(
    <NodeConfigPanel
      descriptor={draw}
      config={{
        collectionIds: ['lore'],
        count: 2,
        requireTags: ['forest', 'sea'],
        anyTags: [],
        excludeTags: ['combat'],
        maxLevel: 2,
        useWeights: false,
      }}
      onChange={() => {}}
      context={{ presets: [], characters: [], providers: [], collections }}
    />,
  );
  expect(html).toContain('>Northern Wastes<');
  expect(html).toContain('href="/collections?id=lore"');
  // Draw has no order, so no move buttons.
  expect(html).not.toContain('Move Northern Wastes');
  expect(html).toContain('value="2"');
  expect(html).toContain('value="forest, sea"');
  expect(html).toContain('value="combat"');
  expect(html).toMatch(/<option value="2" selected="">2<\/option>/);
  expect(html.match(/<option value="" selected="">Any<\/option>/g)).toHaveLength(1);
  expect(html).toMatch(/<input type="checkbox"\/>Use weights/);
});

it('renders without a context, explaining where collections come from', () => {
  const html = renderToStaticMarkup(
    <NodeConfigPanel descriptor={draw} config={{ collectionIds: ['lore'] }} onChange={() => {}} />,
  );
  expect(html).toContain('Unknown collection (lore)');
  expect(html).toContain('Create a collection in the Collections list');
});
