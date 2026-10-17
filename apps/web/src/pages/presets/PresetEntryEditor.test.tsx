import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { presetSchema, stateHints, type Preset } from '@st/shared';
import { definition } from '../stateDefinitions/test-fixtures.js';
import { PresetEntryEditor } from './PresetEntryEditor.js';

const preset: Preset = presetSchema.parse({
  id: '8f1fe1a9-3480-4e52-834c-f25d90684d71',
  name: 'Main',
  inputs: [{ id: 'message-id', key: 'message', dataType: 'text' }],
  entries: [
    {
      id: 'system',
      displayName: 'System',
      kind: 'message',
      enabled: true,
      role: 'system',
      content: 'Hi',
      placement: { mode: 'ordered' },
    },
  ],
  createdAt: '',
  updatedAt: '',
});
const render = (state?: ReturnType<typeof stateHints>) =>
  renderToStaticMarkup(
    <PresetEntryEditor preset={preset} entry={preset.entries[0]} readOnly={false} state={state} onChange={() => {}} />,
  );

it('offers the keys of the state definitions as variables, and a loop over each collection', () => {
  const html = render(stateHints([definition()]));
  expect(html).toContain('>{{state.scene.tension}}</button>');
  expect(html).toContain('>{{state.scene.mood}}</button>');
  expect(html).toContain('>{{state.scene.injected}}</button>');
  expect(html).toContain('>{{#each state.scene.injected}}{{/each}}</button>');
  // Only collections get a loop.
  expect(html).not.toContain('{{#each state.scene.tension}}');
  expect(html).toContain('title="Story state: ');
});

it('offers no state variables without definitions', () => {
  expect(render()).not.toContain('{{state.');
  expect(render([])).not.toContain('{{state.');
  // The other variables are still there.
  expect(render()).toContain('{{input.message}}');
});
