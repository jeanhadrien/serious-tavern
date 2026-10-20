import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { nodeTypeDescriptorSchema } from '@st/shared';
import { definition } from '../stateDefinitions/test-fixtures.js';
import { WorkflowConfigPanel } from './WorkflowConfigPanel.js';

const scene = definition();
const llm = nodeTypeDescriptorSchema.parse({
  type: 'llm',
  label: 'LLM',
  description: 'Generate',
  category: 'AI',
  dynamicPorts: true,
  inputs: [],
  outputs: [],
  configSchema: {},
  defaultConfig: {},
});

const panel = (config: Record<string, unknown>, stateDefinitions: (typeof scene)[] = [scene]) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <WorkflowConfigPanel
        current={{ id: 'llm', position: { x: 0, y: 0 }, data: { descriptor: llm, config, name: 'LLM #1 (llm)' } }}
        presets={[]}
        characters={[]}
        providersList={[{ id: 'openrouter', name: 'OpenRouter' }]}
        stateDefinitions={stateDefinitions}
        updateConfig={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />
    </MemoryRouter>,
  );

it('shows the Tools section of a node saved before tools existed, with empty lists and the defaults', () => {
  const html = panel({ provider: 'openrouter', model: 'm' });
  expect(html).toContain('<h4>Tools</h4>');
  expect(html).toContain('Keys the model may read');
  expect(html).toContain('Keys the model may write');
  expect(html).not.toContain('collection-picker-rows');
  expect(html).toContain('placeholder="5"');
  expect(html).toContain('<option value="auto" selected="">The model chooses</option>');
  expect(html).toContain('<option value="default" selected="">Backend default</option>');
  expect(html).toContain('<option value="never" selected="">Never</option>');
  expect(html).toContain('<option value="sinceLastUser">Since the last user message</option>');
  // The pickers offer every key of the definition; the Add buttons wait for a choice.
  expect(html.match(/<button[^>]*disabled=""[^>]*>Add key<\/button>/g)).toHaveLength(2);
});

it('lists the configured keys of each list, and shows what no longer exists as unknown', () => {
  const html = panel({
    provider: 'openrouter',
    model: 'm',
    maxSteps: 3,
    toolChoice: 'required',
    parallelToolCalls: false,
    replayReasoning: 'always',
    tools: {
      read: [{ definitionId: scene.id, key: 'tension' }],
      write: [
        { definitionId: scene.id, key: 'gone' },
        { definitionId: 'missing-id', key: 'x' },
      ],
    },
  });
  expect(html).toContain('title="scene.tension"');
  expect(html).toContain('aria-label="Remove scene.tension"');
  expect(html).toContain('scene: Unknown key (gone)');
  expect(html).toContain('Unknown definition (missing-id)');
  expect(html.match(/class="unknown"/g)).toHaveLength(2);
  expect(html).toContain('value="3"');
  expect(html).toContain('<option value="required" selected="">Must use a tool first</option>');
  expect(html).toContain('<option value="off" selected="">One at a time</option>');
  expect(html).toContain('<option value="always" selected="">Always</option>');
});
