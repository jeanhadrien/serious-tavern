import type { Preset, StateDefinition, Workflow } from '@st/shared';
import { makeWorkflow } from '../seed.js';
import type { ExamplePack } from '../seed-examples.js';
import { message, narratorIntro, narratorOutro, slot } from './preset-parts.js';

export const PLOT_DEFINITION_ID = 'ac23ac17-f065-4c5f-ab82-a3b0f7ac4b0e';
export const SCENARIST_NARRATOR_PRESET_ID = '9bbd2e1b-a35c-4557-9aa1-1da2535b68a1';
export const SCENARIST_PRESET_ID = '52a57154-d8a9-4dd8-8db7-08eb737e123c';
export const SCENARIST_NARRATOR_WORKFLOW_ID = '3d577eac-98d7-4bcb-8fcc-a99594fdca3f';
export const SCENARIST_WORKFLOW_ID = 'a50c9dc1-50f8-48b3-9c30-aaf93715e5d2';

/** The keys the scenarist steers through its tools; `notes` is where its own exchanges are kept (never a tool target). */
const STEERED_KEYS = ['tension', 'beat', 'threads'];

function plotDefinition(): StateDefinition {
  const date = new Date().toISOString();
  return {
    id: PLOT_DEFINITION_ID,
    name: 'plot',
    description: 'Where the story is heading, steered by the scenarist behind the scenes',
    keys: {
      tension: {
        type: 'number',
        default: 2,
        min: 0,
        max: 10,
        description: 'How tense the current scene is: 0 is calm, 10 is a breaking point.',
      },
      beat: {
        type: 'enum',
        options: ['setup', 'rising', 'twist', 'crisis', 'climax', 'aftermath'],
        default: 'setup',
        description: 'The story beat the scene is in.',
      },
      threads: {
        type: 'collection',
        cap: 10,
        description: 'Open plot threads: questions or promises the story has raised and not yet answered.',
      },
      notes: {
        type: 'thread',
        cap: 20,
        description: "The scenarist's earlier exchanges (what it read, decided and changed), kept for its next turn.",
      },
    },
    createdAt: date,
    updatedAt: date,
  };
}

// The narrator is told where the story is heading, never to mention it. Threads are listed only while there are some.
const DIRECTION_ENTRY =
  'Story direction from the scenarist (follow it quietly, never mention it): the current beat is {{state.plot.beat}} and the tension is {{state.plot.tension}} out of 10.' +
  '{{#if state.plot.threads}}\nOpen plot threads:{{#each state.plot.threads}}\n- {{text}}{{/each}}{{/if}}';

function narratorPreset(): Preset {
  const date = new Date().toISOString();
  return {
    id: SCENARIST_NARRATOR_PRESET_ID,
    name: 'Narrator with a scenarist (example)',
    description:
      'The Default preset plus an entry with the beat, tension and open plot threads the scenarist left in the `plot` state.',
    inputs: [
      { id: 'history', key: 'history', dataType: 'messages' },
      { id: 'message', key: 'message', dataType: 'text' },
    ],
    entries: [
      ...narratorIntro(),
      message('direction', 'Story direction (from the plot state)', DIRECTION_ENTRY),
      slot('history-slot', 'Chat history', 'history'),
      ...narratorOutro(),
      slot('message-slot', 'User message', 'message'),
    ],
    createdAt: date,
    updatedAt: date,
  } as Preset;
}

function scenaristPreset(): Preset {
  const date = new Date().toISOString();
  return {
    id: SCENARIST_PRESET_ID,
    name: 'Scenarist (example)',
    description:
      "Steers the plot through the state tools and writes no prose. The `history` input takes the chat with the scenarist's earlier exchanges woven in.",
    inputs: [{ id: 'history', key: 'history', dataType: 'messages' }],
    entries: [
      message(
        'job',
        'Job',
        'You are the scenarist of this story. A narrator writes the replies the user reads; you work behind the scenes and steer the plot through your tools, and you never write prose for the chat.\nStart by reading the plot state. Then, from the chat, update it: set the tension (0 to 10) to fit the scene, pick the story beat the scene is in, and keep the open plot threads current (add one when the story raises a question or a promise, remove it once it is answered). Change only what needs changing, and let the tension move gradually. When you are done, answer with one short sentence saying what you changed.',
      ),
      message('premise', 'Premise', '{{#if character.scenario}}Scenario: {{character.scenario}}{{/if}}'),
      slot('history-slot', 'Chat history (with earlier exchanges)', 'history'),
      message('ask', 'Instruction', 'Steer the plot for the next reply.', 'user'),
    ],
    createdAt: date,
    updatedAt: date,
  } as Preset;
}

function narratorWorkflow(): Workflow {
  return makeWorkflow(
    SCENARIST_NARRATOR_WORKFLOW_ID,
    'Narrator with a scenarist (example)',
    [
      { id: 'input', type: 'chat-input', at: [100, 100] },
      { id: 'llm', type: 'llm', config: { presetId: SCENARIST_NARRATOR_PRESET_ID }, at: [1200, 100] },
      { id: 'output', type: 'chat-output', at: [1540, 100] },
    ],
    [
      ['input', 'message', 'llm', 'message'],
      ['input', 'history', 'llm', 'history'],
      ['llm', 'text', 'output', 'value'],
    ],
  );
}

// Listed below the narrator, so it has no Chat Output and runs after the reply. The Thread node weaves its earlier
// exchanges (tool calls and results included) into the chat; the LLM node steers the plot through its tools, and its
// exchange is stored on the thread key for the next turn. Thread keys are never tool targets, so `notes` is only here.
function scenaristWorkflow(definitionIds: Record<string, string>): Workflow {
  const definitionId = definitionIds.plot ?? PLOT_DEFINITION_ID;
  const targets = STEERED_KEYS.map((key) => ({ definitionId, key }));
  return makeWorkflow(
    SCENARIST_WORKFLOW_ID,
    'Scenarist (example)',
    [
      { id: 'input', type: 'chat-input', at: [100, 100] },
      { id: 'thread', type: 'thread', config: { definitionId, key: 'notes' }, at: [520, 100] },
      {
        id: 'llm',
        type: 'llm',
        config: {
          presetId: SCENARIST_PRESET_ID,
          temperature: 0.5,
          tools: { read: targets, write: targets },
          maxSteps: 6,
        },
        at: [1200, 100],
      },
      { id: 'keep', type: 'state-write', config: { definitionId, key: 'notes', op: 'add' }, at: [1540, 100] },
    ],
    [
      ['input', 'history', 'thread', 'history'],
      ['thread', 'messages', 'llm', 'history'],
      ['llm', 'exchange', 'keep', 'value'],
    ],
  );
}

/**
 * "Scenarist with tools", two workflows: the narrator, whose prompt carries the `plot` state, and below it "Scenarist"
 * (list it under the narrator in the chat's On reply list), which runs after the reply: an LLM node reads the plot
 * state, adjusts the tension, the beat and the open plot threads through tools, and keeps its exchange in the `notes`
 * thread so the next turn sees what it did.
 */
export const scenarist: ExamplePack = {
  id: 'scenarist',
  name: 'Scenarist with tools (example)',
  collections: () => [],
  definitions: () => [plotDefinition()],
  presets: () => [narratorPreset(), scenaristPreset()],
  workflows: (definitionIds) => [narratorWorkflow(), scenaristWorkflow(definitionIds)],
  uses: { plot: [...STEERED_KEYS, 'notes'] },
};
