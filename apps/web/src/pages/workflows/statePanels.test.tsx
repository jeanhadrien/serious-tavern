import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { nodeTypeDescriptorSchema, type NodeTypeDescriptor } from '@st/shared';
import { definition } from '../stateDefinitions/fixtures.js';
import { WorkflowConfigPanel } from './WorkflowConfigPanel.js';

const scene = definition();

const chatOutput = nodeTypeDescriptorSchema.parse({
  type: 'chat-output',
  label: 'Chat Output',
  description: 'Reply',
  category: 'Chat',
  dynamicPorts: false,
  inputs: [{ name: 'value', label: 'Value', dataType: 'text', required: true }],
  outputs: [],
  templateFields: ['template'],
  configSchema: { type: 'object', properties: { template: { type: 'string', default: '' } } },
  defaultConfig: { template: '' },
});

/** The panel of a node, rendered like the workflow editor does. */
const panel = (descriptor: NodeTypeDescriptor, config: Record<string, unknown>, stateDefinitions?: (typeof scene)[]) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <WorkflowConfigPanel
        current={{ id: 'node', position: { x: 0, y: 0 }, data: { descriptor, config, name: 'Node #1' } }}
        presets={[]}
        characters={[]}
        providersList={[]}
        stateDefinitions={stateDefinitions}
        updateConfig={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />
    </MemoryRouter>,
  );

it('hints the keys of the state definitions in a template field', () => {
  const html = panel(chatOutput, { template: '' }, [scene]);
  expect(html).toContain('{{state.scene.tension}}');
  expect(html).toContain('{{state.scene.mood}}');
  expect(html).toContain('{{#each state.scene.injected}}{{/each}}');
  expect(html).toContain('title="Story state: ');
});

it('hints no state keys without definitions', () => {
  expect(panel(chatOutput, { template: '' })).not.toContain('{{state.');
  expect(panel(chatOutput, { template: '' }, [])).not.toContain('{{state.');
});

const stateRead = nodeTypeDescriptorSchema.parse({
  type: 'state-read',
  label: 'State Read',
  description: 'Read',
  category: 'State',
  dynamicPorts: true,
  inputs: [],
  outputs: [],
  configSchema: {},
  defaultConfig: { definitionId: '', key: '', read: 'value' },
});

describe('State Read panel', () => {
  const read = (config: Record<string, unknown>, definitions: (typeof scene)[] | undefined = [scene]) =>
    panel(stateRead, config, definitions);

  it('shows the saved definition and key selected, with a routed link to edit the definition', () => {
    const html = read({ definitionId: scene.id, key: 'tension', read: 'value' });
    expect(html).toMatch(new RegExp(`<option value="${scene.id}" selected="">scene</option>`));
    expect(html).toContain('<option value="tension" selected="">tension (number)</option>');
    expect(html).toContain('<option value="injected">injected (collection)</option>');
    expect(html).toContain(`href="/state-definitions?id=${scene.id}"`);
    expect(html).toContain('Edit definition ↗');
    expect(html).toContain('<option value="value" selected="">Its value</option>');
    expect(html).toContain('<option value="meta">When it was written</option>');
    expect(html).not.toContain('Create a state definition');
  });

  it('shows an unknown definition first, with no link and no keys to pick', () => {
    const html = read({ definitionId: 'gone', key: 'tension', read: 'value' });
    expect(html).toMatch(/<option value="gone" selected="">Unknown definition \(gone\)<\/option>/);
    expect(html).not.toContain('Edit definition');
    // The key select is off, and still shows the stored key.
    expect(html).toMatch(
      /<select disabled=""[^>]*><option value="">Choose a key<\/option><option value="tension" selected="">Unknown key \(tension\)/,
    );
  });

  it('shows a key the definition lost as unknown, while the link still works', () => {
    const html = read({ definitionId: scene.id, key: 'old', read: 'meta' });
    expect(html).toContain('<option value="old" selected="">Unknown key (old)</option>');
    expect(html).toContain(`href="/state-definitions?id=${scene.id}"`);
    expect(html).toContain('<option value="meta" selected="">When it was written</option>');
  });

  it('asks to create a definition first when there is none', () => {
    const html = read({ definitionId: '', key: '', read: 'value' }, []);
    expect(html).toContain('Create a state definition in the State definitions list first.');
    expect(html).toMatch(/<select disabled="">/);
    expect(panel(stateRead, { definitionId: '', key: '' })).toContain('Create a state definition');
  });

  it('keeps a read value it does not know visible', () => {
    expect(read({ definitionId: scene.id, key: 'tension', read: 'bogus' })).toContain('Unknown read (bogus)');
  });
});
