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

const stateWrite = nodeTypeDescriptorSchema.parse({
  type: 'state-write',
  label: 'State Write',
  description: 'Write',
  category: 'State',
  dynamicPorts: true,
  inputs: [],
  outputs: [],
  configSchema: {},
  defaultConfig: { definitionId: '', key: '', op: 'set' },
});

describe('State Write panel', () => {
  const write = (key: string, op: string, value?: unknown, extra: Record<string, unknown> = {}) =>
    panel(stateWrite, { definitionId: scene.id, key, op, ...(value !== undefined && { value }), ...extra }, [scene]);
  const ops = (html: string) =>
    [...(html.match(/<select[^>]*>(?:(?!<\/select>).)*<\/select>/g) ?? [])]
      .find(
        (select) =>
          select.includes('Set to a value') || select.includes('Add an item') || select.includes('Not allowed'),
      )
      ?.match(/<option value="([a-z]+)"/g)
      ?.map((option) => option.slice(15, -1));

  it('lists only the operations the key type allows', () => {
    expect(ops(write('tension', 'set'))).toEqual(['set', 'increment', 'delete']);
    expect(ops(write('mood', 'set'))).toEqual(['set', 'delete']);
    expect(ops(write('place', 'set'))).toEqual(['set', 'delete']);
    expect(ops(write('quiet', 'set'))).toEqual(['set', 'delete']);
    expect(ops(write('flags', 'set'))).toEqual(['set', 'delete']);
    expect(ops(write('injected', 'add'))).toEqual(['add', 'remove', 'delete']);
    const html = write('tension', 'increment');
    expect(html).toContain('<option value="increment" selected="">Add to the number</option>');
    expect(html).toContain('<option value="delete">Reset to the default</option>');
    expect(write('injected', 'delete')).toContain('<option value="delete" selected="">Empty the list</option>');
  });

  it('keeps an operation the key no longer allows visible, and unknown keys without choices', () => {
    expect(write('place', 'increment')).toContain(
      '<option value="increment" selected="">Not allowed for this key (increment)</option>',
    );
    const unknown = panel(stateWrite, { definitionId: 'gone', key: 'tension', op: 'increment', value: 2 }, [scene]);
    expect(unknown).toMatch(
      /<select disabled=""><option value="increment" selected="">Add to the number<\/option><\/select>/,
    );
    expect(unknown).not.toContain('state-value');
    expect(unknown).toContain('Unknown definition (gone)');
  });

  it('edits a number with its bounds, and an amount that adds 1 when blank', () => {
    const set = write('tension', 'set', 5);
    expect(set).toMatch(/Fixed value<input value="5"\/>/);
    expect(set).toContain('The key stays between 0 and 10: a value outside is clamped.');
    const amount = write('tension', 'increment', 2);
    expect(amount).toMatch(/Amount<input value="2"\/>/);
    expect(amount).toContain('Left blank, it adds 1.');
    expect(write('tension', 'increment')).toMatch(/Amount<input value=""\/>/);
    // 0 is a value.
    expect(write('tension', 'set', 0)).toMatch(/Fixed value<input value="0"\/>/);
  });

  it('shows a number the node would refuse', () => {
    const html = write('tension', 'set', 'five');
    expect(html).toContain('The fixed value is not a number');
    expect(html).toContain('role="alert"');
    expect(write('tension', 'set', 5)).not.toContain('The fixed value');
  });

  it('edits a boolean with a three-way select that can clear', () => {
    const none = write('quiet', 'set');
    expect(none).toContain('<option value="" selected="">No fixed value</option>');
    expect(write('quiet', 'set', false)).toContain('<option value="false" selected="">false</option>');
    expect(write('quiet', 'set', true)).toContain('<option value="true" selected="">true</option>');
  });

  it('edits an enum by its options, and shows a stored value that is not one', () => {
    const html = write('mood', 'set', 'tense');
    expect(html).toContain('<option value="">No fixed value</option>');
    expect(html).toContain('<option value="calm">calm</option>');
    expect(html).toContain('<option value="tense" selected="">tense</option>');
    const foreign = write('mood', 'set', 'sad');
    expect(foreign).toContain('<option value="sad" selected="">(not an option) sad</option>');
    expect(foreign).toContain('The fixed value is not one of: calm, tense');
  });

  it('edits text in a text area and an object as JSON', () => {
    expect(write('place', 'set', 'a tavern')).toMatch(/Fixed value<textarea[^>]*>a tavern<\/textarea>/);
    const object = write('flags', 'set', { a: 1 });
    expect(object).toMatch(/Fixed value \(JSON object\)<textarea[^>]*>\{\n {2}&quot;a&quot;: 1\n\}<\/textarea>/);
    expect(write('flags', 'set')).toMatch(/Fixed value \(JSON object\)<textarea[^>]*><\/textarea>/);
    // A stored value that is not an object is flagged right away, in the box and by the node's own check.
    const wrong = write('flags', 'set', 'oops');
    expect(wrong).toContain('<small class="error" role="alert">Not a JSON object</small>');
    expect(wrong).toContain('The fixed value is not an object');
    expect(object).not.toContain('Not a JSON object');
  });

  it('edits an item to add: its text and a control per declared field', () => {
    const empty = write('injected', 'add');
    expect(empty).toMatch(/Item text<textarea[^>]*><\/textarea>/);
    expect(empty).toContain('level (number)');
    expect(empty).not.toContain('Item id');
    const html = write('injected', 'add', { text: 'a bell', level: 2 });
    expect(html).toMatch(/Item text<textarea[^>]*>a bell<\/textarea>/);
    expect(html).toMatch(/level \(number\)<input value="2"\/>/);
    expect(write('injected', 'add', 'plain')).toMatch(/Item text<textarea[^>]*>plain<\/textarea>/);
    expect(write('injected', 'add', { level: 2 })).toContain(
      'The fixed item must be text, or an object with a text field',
    );
  });

  it('edits the id to remove, and needs no value for a reset', () => {
    const remove = write('injected', 'remove', 'e1');
    expect(remove).toMatch(/Item id<input value="e1"\/>/);
    expect(remove).not.toContain('Item text');
    for (const [key, op] of [
      ['tension', 'delete'],
      ['injected', 'delete'],
      ['mood', 'delete'],
    ] as const) {
      const html = write(key, op);
      expect(html).toContain('This operation needs no value.');
      expect(html).not.toMatch(/Fixed value<|Amount</);
    }
  });

  it('explains the fixed value and the optional Run when input', () => {
    const html = write('tension', 'set', 5);
    expect(html).toContain('Fixed value: stored when nothing is connected to Value; a connected input wins.');
    expect(html).toContain('Run when (optional input)');
    expect(html).toContain('Condition branch');
    expect(html).toContain('Random chance');
  });

  it('shares the picker with State Read, including the link to edit the definition', () => {
    const html = write('tension', 'set', 5);
    expect(html).toContain('<option value="tension" selected="">tension (number)</option>');
    expect(html).toContain(`href="/state-definitions?id=${scene.id}"`);
  });
});
