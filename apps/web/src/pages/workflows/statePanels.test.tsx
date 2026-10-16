import { expect, it } from 'vitest';
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
