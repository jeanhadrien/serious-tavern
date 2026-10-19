import type { Collection, CollectionEntry, Preset, Workflow, WorkflowSetting } from '@st/shared';
import { makeWorkflow } from '../seed.js';
import { message, narratorIntro, narratorOutro, slot } from './preset-parts.js';
import { sceneDefinition } from '../seed-state.js';
import type { ExamplePack } from '../seed-examples.js';

export const FOREST_COLLECTION_ID = '3b7e5a10-62c4-4d0b-8f41-2a9d6c1e7f05';
export const NARRATOR_PRESET_ID = '6c0f9d32-1b8a-4e57-a3d6-9e4b2f7c8a11';
export const FRESH_TEXTURE_WORKFLOW_ID = 'a4d28e6b-7f19-4c35-b0e2-5d1c9a3f6e72';

type Seed = [text: string, tags: string[], level: 1 | 2 | 3, weight?: number];

// Self-written sensory details, small objects, sounds and traces of earlier visitors. Level 1 is a passing detail,
// 2 something the scene can notice, 3 something that wants a reaction.
const SEEDS: Seed[] = [
  ['A thread of woodsmoke drifts through the trees from somewhere unseen.', ['sensory', 'smell'], 1, 3],
  ['Water drips from a leaf onto stone, each drop a small clear note.', ['sound'], 1, 3],
  ['Moss has swallowed the north side of every trunk, thick and wet to the touch.', ['sensory', 'touch'], 1, 2],
  ['A beetle with a green shell crosses the path, unhurried, and vanishes under a root.', ['creature'], 1, 2],
  ['Light comes down in slanted columns, and dust turns slowly inside them.', ['sensory', 'light'], 1, 3],
  ['Far off, one bird repeats the same three notes and never finishes the phrase.', ['sound'], 1],
  ['The air smells of resin and cold earth.', ['sensory', 'smell'], 1, 2],
  [
    'An old anchor post stands alone in the clearing, its bridge long gone, the wood worn smooth by hands.',
    ['object', 'history'],
    2,
  ],
  ['A ring of pale mushrooms has grown around a hollow stump, too neat to be an accident.', ['object'], 2, 2],
  [
    'Fresh boot prints cross the path, deep at the toe as if someone had been running, and stop at the water.',
    ['trace', 'history'],
    2,
  ],
  ['The wind drops all at once. For a moment even the leaves hold still.', ['weather', 'sound'], 2, 2],
  [
    'Someone carved a small spiral into a birch trunk, and the bark has healed around the lines.',
    ['object', 'history'],
    2,
  ],
  ['A stream cuts the path. One stepping stone is missing, another polished by use.', ['object'], 2],
  ['The birdsong stops mid-phrase, and stays stopped.', ['sound'], 2, 2],
  ['A bell rings once, far below the hill, where no village should be.', ['sound', 'mystery'], 3],
  [
    'Under a fallen trunk lies a leather satchel, dry inside though the ground around it is soaked, its strap neatly tied.',
    ['object', 'mystery'],
    3,
  ],
  [
    'A line of old stones marks a path no map shows, and each stone has a coin pressed into its top.',
    ['history', 'mystery'],
    3,
    0.5,
  ],
  ['Fog rises from the ground in the space of a few breaths, and the way back is no longer certain.', ['weather'], 3],
  ['A lantern hangs from a branch, lit, with no one near and its oil still warm.', ['object', 'mystery'], 3, 0.5],
  [
    'Trees here are notched at shoulder height, and the newest cuts are still bright with sap.',
    ['trace', 'history'],
    3,
  ],
];

function forestCollection(): Collection {
  const date = new Date().toISOString();
  return {
    id: FOREST_COLLECTION_ID,
    name: 'Forest textures (example)',
    description:
      'Small details to weave into a scene. Level 1 is a passing detail, 2 something the scene can notice, 3 something that wants a reaction. Written for the Fresh texture example; edit freely.',
    entries: SEEDS.map(
      ([text, tags, level, weight = 1]): CollectionEntry => ({ text, tags, level, weight, enabled: true }),
    ),
    createdAt: date,
    updatedAt: date,
  };
}

// One line each, so no blank lines reach the prompt. The wording offers the detail; it never orders it.
const TEXTURE_WORDING =
  '{{#if input.seed}}{{#if (eq input.level "1")}}Optional color, only if it fits the moment: {{input.seed}}' +
  '{{else if (eq input.level "2")}}If the story has room, let this touch the scene in a sentence or two: {{input.seed}}' +
  '{{else}}If it serves the story, you may bring this in as something the characters notice and react to: {{input.seed}}' +
  '{{/if}}{{/if}}';

function narratorPreset(): Preset {
  const date = new Date().toISOString();
  return {
    id: NARRATOR_PRESET_ID,
    name: 'Fresh texture narrator (example)',
    description:
      'The Default preset plus a depth entry that words the detail Draw picked by its level. Without a detail (the Trigger did not fire) the entry is empty and disappears.',
    inputs: [
      { id: 'history', key: 'history', dataType: 'messages' },
      { id: 'message', key: 'message', dataType: 'text' },
      { id: 'seed', key: 'seed', dataType: 'text' },
      { id: 'level', key: 'level', dataType: 'text' },
    ],
    entries: [
      ...narratorIntro(),
      slot('history-slot', 'Chat history', 'history'),
      {
        ...message('texture', 'Fresh texture (worded by level)', TEXTURE_WORDING),
        placement: { mode: 'depth', entryId: 'history-slot', depth: 2 },
      },
      ...narratorOutro(),
      slot('message-slot', 'User message', 'message'),
    ],
    createdAt: date,
    updatedAt: date,
  } as Preset;
}

const SETTINGS: WorkflowSetting[] = [
  {
    key: 'volatility',
    type: 'number',
    label: 'Volatility',
    description: 'How eager the story is to inject something new: 0 is calm, 1 is restless.',
    default: 0.3,
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: 'maxLevel',
    type: 'number',
    label: 'Max level',
    description: 'The strongest injection that may fire: 1 is a passing detail, 3 wants a reaction.',
    default: 2,
    min: 1,
    max: 5,
    step: 1,
  },
];

function freshTextureWorkflow(definitionIds: Record<string, string>): Workflow {
  const scene = definitionIds.scene ?? sceneDefinition().id;
  const workflow = makeWorkflow(
    FRESH_TEXTURE_WORKFLOW_ID,
    'Fresh texture (example)',
    [
      { id: 'input', type: 'chat-input', at: [100, 100] },
      { id: 'volatility', type: 'chat-settings', config: { key: 'volatility' }, at: [100, 330] },
      { id: 'maxLevel', type: 'chat-settings', config: { key: 'maxLevel' }, at: [100, 560] },
      { id: 'trigger', type: 'trigger', at: [520, 330] },
      {
        id: 'draw',
        type: 'draw',
        config: { collectionIds: [FOREST_COLLECTION_ID], avoidRecent: 10 },
        at: [880, 330],
      },
      { id: 'llm', type: 'llm', config: { presetId: NARRATOR_PRESET_ID }, at: [1200, 100] },
      { id: 'output', type: 'chat-output', at: [1540, 100] },
      // Draw's entry has more fields than `scene.injected` declares: keep only the ones it does.
      { id: 'pick', type: 'pick-fields', config: { fields: 'text, level, entryId' }, at: [1200, 440] },
      {
        id: 'remember',
        type: 'state-write',
        config: { definitionId: scene, key: 'injected', op: 'add' },
        at: [1540, 440],
      },
      {
        id: 'level',
        type: 'state-write',
        config: { definitionId: scene, key: 'lastInjectionLevel', op: 'set' },
        at: [1200, 700],
      },
    ],
    [
      ['input', 'message', 'llm', 'message'],
      ['input', 'history', 'llm', 'history'],
      ['volatility', 'value', 'trigger', 'volatility'],
      ['maxLevel', 'value', 'trigger', 'maxLevel'],
      // Draw only runs when the Trigger fired (no level, no draw), and then draws up to that level.
      ['trigger', 'level', 'draw', 'maxLevel'],
      ['draw', 'text', 'llm', 'seed'],
      ['draw', 'level', 'llm', 'level'],
      ['draw', 'entry', 'pick', 'value'],
      ['pick', 'value', 'remember', 'value'],
      ['draw', 'level', 'level', 'value'],
      ['llm', 'text', 'output', 'value'],
    ],
  );
  return { ...workflow, settings: SETTINGS };
}

/**
 * "Fresh texture": now and then, a small detail from a deck of forest textures is put into the prompt, worded by how
 * strong it is. Trigger decides whether and how strongly, Draw picks the detail (never one from the last 10 turns),
 * the preset words it, and the scene state remembers what was injected.
 */
export const freshTexture: ExamplePack = {
  id: 'fresh-texture',
  name: 'Fresh texture (example)',
  collections: () => [forestCollection()],
  definitions: () => [sceneDefinition()],
  presets: () => [narratorPreset()],
  workflows: (definitionIds) => [freshTextureWorkflow(definitionIds)],
  uses: { scene: ['injected', 'lastInjectionLevel'] },
};
