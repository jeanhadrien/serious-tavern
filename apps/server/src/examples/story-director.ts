import type { Preset, StateDefinition, Workflow } from '@st/shared';
import { makeWorkflow } from '../seed.js';
import type { ExamplePack } from '../seed-examples.js';
import { message, narratorIntro, narratorOutro, slot } from './preset-parts.js';
import { BEATS_COLLECTION_ID, beatsCollection } from './story-beats.js';

export const DIRECTOR_DEFINITION_ID = 'b2e94c71-8d35-4a06-9f1e-6c3a7d0b5e82';
export const DIRECTOR_NARRATOR_PRESET_ID = '4a8d1f60-9b27-4c35-a0e8-3d7c5b1e9f24';
export const RATE_TENSION_PRESET_ID = 'e0c63b95-17a4-4d82-b6f9-5a2d8e4c1b70';
export const STORY_DIRECTOR_WORKFLOW_ID = '7f1b5d38-c249-4e06-8a73-d9e0b4a6c512';

function directorDefinition(): StateDefinition {
  const date = new Date().toISOString();
  return {
    id: DIRECTOR_DEFINITION_ID,
    name: 'director',
    description: 'What the Story Director example measures of the story',
    keys: { tension: { type: 'number', default: 0, min: 0, max: 1 } },
    createdAt: date,
    updatedAt: date,
  };
}

// One line each, so no blank lines reach the prompt. The pacing note directs; the texture only offers.
const GUIDANCE_WORDING = '{{#if input.guidance}}Story pacing: {{input.guidance}}{{/if}}';
const SEED_WORDING = '{{#if input.seed}}If it fits, weave in: {{input.seed}}{{/if}}';

function narratorPreset(): Preset {
  const date = new Date().toISOString();
  return {
    id: DIRECTOR_NARRATOR_PRESET_ID,
    name: 'Story Director narrator (example)',
    description:
      "The Default preset plus the Pacing node's directive for the current phase and, when the Trigger fired, an optional detail to weave in. Both entries are empty (and disappear) without their input.",
    inputs: [
      { id: 'history', key: 'history', dataType: 'messages' },
      { id: 'message', key: 'message', dataType: 'text' },
      { id: 'guidance', key: 'guidance', dataType: 'text' },
      { id: 'seed', key: 'seed', dataType: 'text' },
    ],
    entries: [
      ...narratorIntro(),
      slot('history-slot', 'Chat history', 'history'),
      {
        ...message('guidance', 'Pacing directive', GUIDANCE_WORDING),
        placement: { mode: 'depth', entryId: 'history-slot', depth: 1 },
      },
      {
        ...message('texture', 'Optional detail', SEED_WORDING),
        placement: { mode: 'depth', entryId: 'history-slot', depth: 2 },
      },
      ...narratorOutro(),
      slot('message-slot', 'User message', 'message'),
    ],
    createdAt: date,
    updatedAt: date,
  } as Preset;
}

function ratePreset(): Preset {
  const date = new Date().toISOString();
  return {
    id: RATE_TENSION_PRESET_ID,
    name: 'Rate tension (example)',
    description:
      'Rates how intense the latest exchange was, 0 to 1. The Story Director example runs it after the reply and the Pacing node reads the rating next turn.',
    inputs: [{ id: 'text', key: 'text', dataType: 'text' }],
    entries: [
      message(
        'instruction',
        'Instruction',
        "Rate how intense the latest exchange is for the story's pacing: 0 is calm (quiet, everyday, relaxed), 0.5 is rising tension, 1 is a climax (danger, confrontation, a decisive moment). Answer with only a number from 0 to 1.",
      ),
      message('exchange', 'Exchange', 'User: {{trigger.message}}\nReply: {{input.text}}', 'user'),
    ],
    createdAt: date,
    updatedAt: date,
  } as Preset;
}

function storyDirectorWorkflow(definitionIds: Record<string, string>): Workflow {
  const director = definitionIds.director ?? DIRECTOR_DEFINITION_ID;
  return makeWorkflow(
    STORY_DIRECTOR_WORKFLOW_ID,
    'Story Director (example)',
    [
      { id: 'input', type: 'chat-input', at: [100, 100] },
      // The signals: how stuck the story is, and what the director thinks of the pace.
      { id: 'stagnation', type: 'stagnation', at: [100, 330] },
      { id: 'tension', type: 'state-read', config: { definitionId: director, key: 'tension' }, at: [100, 560] },
      { id: 'pacing', type: 'pacing', at: [520, 560] },
      {
        id: 'trigger',
        type: 'trigger',
        config: {
          baseChance: 0.05,
          growthPerTurn: 0.02,
          volatility: 0.5,
          signals: [
            { name: 'stagnation', weight: 0.4 },
            { name: 'pressure', weight: 0.5 },
          ],
        },
        at: [880, 330],
      },
      { id: 'draw', type: 'draw', config: { collectionIds: [BEATS_COLLECTION_ID], avoidRecent: 10 }, at: [1200, 330] },
      { id: 'llm', type: 'llm', config: { presetId: DIRECTOR_NARRATOR_PRESET_ID }, at: [1540, 100] },
      { id: 'output', type: 'chat-output', at: [1880, 100] },
      // After the reply: rate how intense it was; the director reads the rating next turn.
      { id: 'after', type: 'after-reply', at: [100, 820] },
      {
        id: 'rate',
        type: 'llm',
        config: { presetId: RATE_TENSION_PRESET_ID, temperature: 0, maxTokens: 20 },
        at: [520, 820],
      },
      { id: 'parse', type: 'parse-json', config: { expect: 'number' }, at: [880, 820] },
      {
        id: 'save',
        type: 'state-write',
        config: { definitionId: director, key: 'tension', op: 'set' },
        at: [1200, 820],
      },
    ],
    [
      ['input', 'message', 'llm', 'message'],
      ['input', 'history', 'llm', 'history'],
      ['stagnation', 'score', 'trigger', 'stagnation'],
      ['tension', 'value', 'pacing', 'tension'],
      // The director caps the Trigger's level and pushes it. Draw takes the level the Trigger chose (never above that
      // cap), so it only runs, and only remembers a draw, on a turn the Trigger fired.
      ['pacing', 'maxLevel', 'trigger', 'maxLevel'],
      ['pacing', 'pressure', 'trigger', 'pressure'],
      ['trigger', 'level', 'draw', 'maxLevel'],
      ['pacing', 'guidance', 'llm', 'guidance'],
      ['draw', 'text', 'llm', 'seed'],
      ['llm', 'text', 'output', 'value'],
      ['after', 'text', 'rate', 'text'],
      ['rate', 'text', 'parse', 'text'],
      ['parse', 'value', 'save', 'value'],
    ],
  );
}

/**
 * "Story Director": pacing instead of constant random twists. Pacing cycles build, peak, fade and relax; it caps and
 * pushes the Trigger and tells the model the phase's directive; a Stagnation signal nudges the Trigger when the story
 * is stuck; Draw offers a detail when the Trigger fires. After the reply a rating call writes how tense the exchange
 * was, which Pacing reads next turn. Its own deck, "Story beats", has events from level 1 to 5.
 */
export const storyDirector: ExamplePack = {
  id: 'story-director',
  name: 'Story Director (example)',
  collections: () => [beatsCollection()],
  definitions: () => [directorDefinition()],
  presets: () => [narratorPreset(), ratePreset()],
  workflow: storyDirectorWorkflow,
  uses: { director: ['tension'] },
};
