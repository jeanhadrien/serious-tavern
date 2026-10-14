import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiContract, characterSchema, type Persona } from '@st/shared';
import { WorkflowConfigPanel } from './workflows/WorkflowConfigPanel.js';
import { workflowToCanvas } from './workflows/model.js';
import { EntityDetail } from './entities/EntityDetail.js';
import { EntityPortrait } from './entities/EntityAvatar.js';
import { CharacterFields } from './entities/CharacterFields.js';
import { PersonaFields } from './entities/PersonaFields.js';
import { NodeConfigPanel } from '@st/node-ui';
import { ChatMessageView } from './chat/ChatMessageView.js';

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
      characters={[]}
      providersList={[]}
      updateConfig={() => {}}
      onDelete={() => {}}
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
    <EntityDetail
      title={persona.name}
      backLabel="Back to personas"
      dirty={false}
      onBack={() => {}}
      onDelete={async () => {}}
      onSave={async () => {}}
    >
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

it('renders output name/order controls and a character picker', () => {
  const descriptor = {
    type: 'chat-output',
    label: 'Chat Output',
    description: '',
    category: 'Chat',
    dynamicPorts: false,
    inputs: [],
    outputs: [],
    defaultConfig: {},
    configSchema: {
      properties: {
        name: { type: 'string', default: '' },
        order: { type: 'number', default: 0 },
      },
    },
  };
  const output = renderToStaticMarkup(
    <NodeConfigPanel descriptor={descriptor} config={{ name: 'foo', order: 2 }} onChange={() => {}} />,
  );
  expect(output).toContain('foo');
  expect(output).toContain('type="number"');
  expect(output).toContain('value="2"');
  const card = characterSchema.parse({
    ...apiContract.createCharacter.body.parse({ name: 'Card' }),
    id: 'card',
    avatar: false,
    createdAt: '',
    updatedAt: '',
  });
  const picker = renderToStaticMarkup(
    <NodeConfigPanel
      descriptor={{ ...descriptor, type: 'character' }}
      config={{ source: 'card', characterId: 'card' }}
      context={{ characters: [card], presets: [], providers: [] }}
      onChange={() => {}}
    />,
  );
  expect(picker).toContain('Session character');
  expect(picker).toContain('value="card" selected=""');
});

it('renders speaker snapshots, optional avatars, and execution warnings/errors', () => {
  const card = characterSchema.parse({
    ...apiContract.createCharacter.body.parse({ name: 'Renamed card' }),
    id: 'card',
    avatar: 'card.png',
    createdAt: '',
    updatedAt: '',
  });
  const html = renderToStaticMarkup(
    <ChatMessageView
      message={{
        id: 'message',
        role: 'assistant',
        name: 'Original speaker',
        characterId: 'card',
        content: 'Kept reply',
        createdAt: '',
        executionId: 'execution',
      }}
      character={card}
      execution={{
        id: 'execution',
        workflowId: 'workflow',
        sessionId: 'session',
        status: 'error',
        startedAt: '',
        warnings: ['No outputs ran'],
        nodes: { failure: { status: 'error', error: 'Later failure' } },
      }}
    />,
  );
  expect(html).toContain('Original speaker');
  expect(html).not.toContain('Renamed card');
  expect(html).toContain('/api/characters/card/avatar');
  expect(html).toContain('Kept reply');
  expect(html).toContain('No outputs ran');
  expect(html).toContain('Later failure');
});
