import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { NodeConfigPanel } from '@st/node-ui';
import { nodeTypeDescriptorSchema, presetSchema } from '@st/shared';
import { WorkflowConfigPanel } from './WorkflowConfigPanel.js';

const descriptor = nodeTypeDescriptorSchema.parse({
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
const preset = presetSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Test preset',
  createdAt: '',
  updatedAt: '',
  inputs: [{ id: 'history', key: 'history', dataType: 'messages' }],
  entries: [],
});
const config = {
  provider: 'openrouter',
  model: 'test/model',
  presetId: preset.id,
  temperature: 0.7,
  maxTokens: 1024,
  mergeSystemMessages: true,
  stop: ['END', 'STOP'],
};

it('renders the registered LLM panel with the same controls, preset summary and routed link', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <WorkflowConfigPanel
        current={{ id: 'llm', position: { x: 0, y: 0 }, data: { descriptor, config, name: 'LLM #1 (llm)' } }}
        presets={[preset]}
        characters={[]}
        providersList={[{ id: 'openrouter', name: 'OpenRouter' }]}
        updateConfig={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />
    </MemoryRouter>,
  );
  expect(html).toContain('OpenRouter');
  expect(html).toContain('value="test/model"');
  expect(html).toContain('Test preset');
  expect(html).toContain('history : messages');
  expect(html).toContain(`href="/presets?id=${preset.id}"`);
  expect(html).toContain('Edit preset ↗');
  expect(html).toContain('Merge consecutive system messages');
  expect(html).toContain('checked=""');
  expect(html.match(/type="number"/g)).toHaveLength(6);
  expect(html).toContain('Reasoning effort');
  expect(html).toContain('Reasoning max tokens');
  expect(html).toContain('Stream the response');
  expect(html).toContain('step="1" value="1024"');
  expect(html).toContain('END\nSTOP');
  expect(html).not.toContain('kv-list');
});

it('supports empty panel context and an ordinary preset link when no router renderer is supplied', () => {
  const html = renderToStaticMarkup(<NodeConfigPanel descriptor={descriptor} config={config} onChange={() => {}} />);
  expect(html).toContain('Choose a preset');
  expect(html).toContain(`href="/presets?id=${preset.id}"`);
  expect(html).not.toContain('preset-port-summary');
});

it('keeps generic template hints sourced from the macro registry', () => {
  const html = renderToStaticMarkup(
    <NodeConfigPanel
      descriptor={{
        ...descriptor,
        type: 'custom-template',
        templateFields: ['template'],
        inputs: [{ name: 'message', label: 'Message', dataType: 'text' }],
        configSchema: { properties: { template: { type: 'string' } } },
      }}
      config={{ template: '' }}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('{{character.name}}');
  expect(html).toContain('{{input.message}}');
  expect(html).toContain('{{user}}');
  expect(html).not.toContain('{{char.name}}');
});

it('renders only key/value arrays as editable rows, preserving unsupported shapes as read-only JSON', () => {
  const html = renderToStaticMarkup(
    <NodeConfigPanel
      descriptor={{
        ...descriptor,
        type: 'custom-array',
        templateFields: ['headers', 'tags'],
        configSchema: {
          properties: {
            headers: {
              type: 'array',
              items: {
                type: 'object',
                properties: { key: { type: 'string' }, value: { type: 'string' } },
                required: ['key', 'value'],
              },
            },
            tags: { type: 'array', items: { type: 'string' } },
            other: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
          },
        },
      }}
      config={{
        headers: [{ key: 'Accept', value: 'application/json' }],
        tags: ['keep me'],
        other: [{ name: 'original' }],
      }}
      onChange={() => {}}
    />,
  );
  expect(html.match(/class="kv-list"/g)).toHaveLength(1);
  expect(html).toContain('value="Accept"');
  expect(html).toContain('value="application/json"');
  expect(html.match(/Read-only:/g)).toHaveLength(2);
  expect(html).toContain('keep me');
  expect(html).toContain('original');
  expect(html).not.toContain('tags key');
});

it('renders malformed values in supported array schemas read-only instead of crashing or dropping rows', () => {
  const html = renderToStaticMarkup(
    <NodeConfigPanel
      descriptor={{
        ...descriptor,
        type: 'custom-array',
        configSchema: {
          properties: {
            headers: {
              type: 'array',
              items: {
                type: 'object',
                properties: { key: { type: 'string' }, value: { type: 'string' } },
                required: ['key', 'value'],
              },
            },
          },
        },
      }}
      config={{ headers: [null, 'original'] }}
      onChange={() => {}}
    />,
  );
  expect(html).toContain('Read-only:');
  expect(html).toContain('original');
  expect(html).not.toContain('kv-list');
});

it('renders the Model field as a combobox with a refresh button only when the host can load models', () => {
  const render = (loadModels?: () => Promise<never>) =>
    renderToStaticMarkup(
      <NodeConfigPanel
        descriptor={descriptor}
        config={config}
        onChange={() => {}}
        context={{ presets: [], characters: [], providers: [], loadModels }}
      />,
    );
  const withLoader = render(() => new Promise(() => {}));
  expect(withLoader).toContain('role="combobox"');
  expect(withLoader).toContain('value="test/model"');
  expect(withLoader).toContain('aria-label="Refresh model list"');
  expect(withLoader).toContain('Loading models');
  const without = render();
  expect(without).toContain('role="combobox"');
  expect(without).not.toContain('Refresh model list');
});

it('renders enum dropdowns, blank optional numbers and field descriptions in the generic form', () => {
  const random = nodeTypeDescriptorSchema.parse({
    type: 'random',
    label: 'Random',
    description: 'Roll',
    category: 'Logic',
    dynamicPorts: true,
    inputs: [],
    outputs: [],
    configSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['number', 'integer', 'pick', 'chance'], default: 'number' },
        min: { type: 'number', description: 'Blank: 0 in number mode, 1 in integer mode' },
      },
    },
    defaultConfig: { mode: 'number' },
  });
  const html = renderToStaticMarkup(
    <NodeConfigPanel descriptor={random} config={{ mode: 'integer' }} onChange={() => {}} />,
  );
  expect(html).toContain('<option value="integer" selected="">integer</option>');
  expect(html).toContain('<input type="number" value=""/>');
  expect(html).toContain('<small class="hint">Blank: 0 in number mode, 1 in integer mode</small>');
});
