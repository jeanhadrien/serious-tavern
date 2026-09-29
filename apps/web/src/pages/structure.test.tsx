import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiContract, characterSchema, type Persona } from '@st/shared';
import { WorkflowConfigPanel } from './workflows/WorkflowConfigPanel.js';
import { workflowToCanvas } from './workflows/model.js';
import { EntityDetail } from './entities/EntityDetail.js';
import { EntityPortrait } from './entities/EntityAvatar.js';
import { CharacterFields } from './entities/CharacterFields.js';
import { PersonaFields } from './entities/PersonaFields.js';

it('renders unavailable workflow node configuration read-only', () => {
  const model = workflowToCanvas(
    {
      id: 'workflow',
      name: 'Unknown',
      createdAt: '',
      updatedAt: '',
      edges: [],
      nodes: [{ id: 'node', type: 'unavailable', config: { keep: 'original' }, position: { x: 0, y: 0 } }],
    },
    [],
  );
  const html = renderToStaticMarkup(
    <WorkflowConfigPanel
      current={model.nodes[0]!}
      presets={[]}
      providersList={[]}
      updateConfig={() => {}}
      onClose={() => {}}
    />,
  );
  expect(html).toContain('unknown-config');
  expect(html).toContain('original');
  expect(html).not.toContain('<input');
  expect(html).not.toContain('<textarea');
});

it('retains entity dirty/save state and versioned avatar URLs', () => {
  const persona: Persona = {
    id: 'p',
    name: 'User',
    description: '',
    avatar: 'p.png',
    createdAt: '',
    updatedAt: 'version',
  };
  const html = renderToStaticMarkup(
    <EntityDetail title={persona.name} dirty={false} onDelete={async () => {}} onSave={async () => {}}>
      <EntityPortrait type="personas" item={persona} large />
    </EntityDetail>,
  );
  expect(html).toContain('/api/personas/p/avatar?v=version');
  expect(html).toContain('disabled=""');
  expect(html).not.toContain('Unsaved');
});

it('keeps character advanced fields and persona description distinct', () => {
  const character = characterSchema.parse({
    ...apiContract.createCharacter.body.parse({ name: 'Character' }),
    id: 'c',
    avatar: false,
    createdAt: '',
    updatedAt: '',
  });
  const characterHtml = renderToStaticMarkup(<CharacterFields draft={character} change={() => {}} />);
  expect(characterHtml).toContain('character-advanced');
  expect(characterHtml).toContain('Post-history instructions');
  expect(characterHtml).toContain('Extensions (JSON)');
  const personaHtml = renderToStaticMarkup(
    <PersonaFields
      draft={{
        id: 'p',
        name: 'Persona',
        description: 'Description',
        avatar: false,
        createdAt: '',
        updatedAt: '',
      }}
      change={() => {}}
    />,
  );
  expect(personaHtml).toContain('rows="8"');
  expect(personaHtml).not.toContain('character-advanced');
});
