import type { Preset, StateDefinition, Workflow } from '@st/shared';
import { makeWorkflow } from '../seed.js';
import type { ExamplePack } from '../seed-examples.js';
import { message, narratorIntro, narratorOutro, slot } from './preset-parts.js';

export const MEMORY_DEFINITION_ID = 'e7b3c914-5a26-4f08-9d71-3c8a0b6e2f45';
export const SUMMARIES_NARRATOR_PRESET_ID = '1f5d8a07-c3e9-4b62-8a14-7d0e9b2c6a53';
export const SUMMARIZE_PRESET_ID = '9a2c6e18-4d70-4f3b-b5a9-0e8d1c7f3b26';
export const ROLLING_SUMMARIES_WORKFLOW_ID = 'c58f0b3d-2e91-4a74-86c0-b1d5a9e3f708';
export const SUMMARIZE_WORKFLOW_ID = 'ee18aa63-5f49-4ba7-bf50-792733b39d40';

function memoryDefinition(): StateDefinition {
  const date = new Date().toISOString();
  return {
    id: MEMORY_DEFINITION_ID,
    name: 'memory',
    description: 'What a chat remembers about its earlier messages (rolling summaries)',
    // No cap: a cap drops the oldest summaries, and their messages would reach the prompt raw again.
    keys: { summaries: { type: 'collection' } },
    createdAt: date,
    updatedAt: date,
  };
}

// The intact summaries in chat order, the first one introduced and a blank line between them. Nothing without any.
const SUMMARIES_ENTRY =
  '{{#each (linked state.memory.summaries)}}{{#if @first}}Summary of the earlier chat:\n{{else}}\n\n{{/if}}{{text}}{{/each}}';

function narratorPreset(): Preset {
  const date = new Date().toISOString();
  return {
    id: SUMMARIES_NARRATOR_PRESET_ID,
    name: 'Narrator with summaries (example)',
    description:
      'The Default preset with the summaries of the earlier chat before the recent messages. The `recent` input holds only the messages no summary stands for.',
    inputs: [
      { id: 'recent', key: 'recent', dataType: 'messages' },
      { id: 'message', key: 'message', dataType: 'text' },
    ],
    entries: [
      ...narratorIntro(),
      message('summaries', 'Summaries of the earlier chat', SUMMARIES_ENTRY),
      slot('recent-slot', 'Messages no summary covers', 'recent'),
      ...narratorOutro(),
      slot('message-slot', 'User message', 'message'),
    ],
    createdAt: date,
    updatedAt: date,
  } as Preset;
}

function summarizePreset(): Preset {
  const date = new Date().toISOString();
  return {
    id: SUMMARIZE_PRESET_ID,
    name: 'Summarize (example)',
    description: 'Condenses a stretch of chat into notes. Edit the instruction to change what a summary keeps.',
    inputs: [{ id: 'text', key: 'text', dataType: 'text' }],
    entries: [
      message(
        'instruction',
        'Instruction',
        'Condense the chat excerpt into notes the story can be continued from later. Keep names, what happened, decisions, relationships, promises and open threads. Write plain prose in under 150 words, and write only the notes.',
      ),
      message('excerpt', 'Chat excerpt', 'Chat excerpt:\n{{input.text}}', 'user'),
    ],
    createdAt: date,
    updatedAt: date,
  } as Preset;
}

function rollingSummariesWorkflow(definitionIds: Record<string, string>): Workflow {
  const target = { definitionId: definitionIds.memory ?? MEMORY_DEFINITION_ID, key: 'summaries' };
  return makeWorkflow(
    ROLLING_SUMMARIES_WORKFLOW_ID,
    'Rolling summaries (example)',
    [
      // The reply: every message no intact summary stands for, plus the summaries themselves from the preset.
      { id: 'input', type: 'chat-input', at: [100, 100] },
      { id: 'history', type: 'memory', config: { all: true, format: 'messages' }, at: [100, 330] },
      { id: 'unlinked', type: 'unlinked-messages', config: target, at: [520, 330] },
      { id: 'llm', type: 'llm', config: { presetId: SUMMARIES_NARRATOR_PRESET_ID }, at: [1200, 100] },
      { id: 'output', type: 'chat-output', at: [1540, 100] },
    ],
    [
      ['input', 'message', 'llm', 'message'],
      ['history', 'history', 'unlinked', 'messages'],
      ['unlinked', 'messages', 'llm', 'recent'],
      ['llm', 'text', 'output', 'value'],
    ],
  );
}

// Listed below the narrator, so it has no Chat Output and runs after the reply: the next chunk nobody summarized yet is
// summarized and stored with a link to its messages.
function summarizeWorkflow(definitionIds: Record<string, string>): Workflow {
  const target = { definitionId: definitionIds.memory ?? MEMORY_DEFINITION_ID, key: 'summaries' };
  return makeWorkflow(
    SUMMARIZE_WORKFLOW_ID,
    'Summarize history (example)',
    [
      { id: 'input', type: 'chat-input', at: [100, 100] },
      { id: 'chunk', type: 'next-chunk', config: { ...target, chunkSize: 20, rawWindow: 16 }, at: [520, 100] },
      {
        id: 'summarize',
        type: 'llm',
        config: { presetId: SUMMARIZE_PRESET_ID, temperature: 0.3, maxTokens: 400 },
        at: [1200, 20],
      },
      { id: 'save', type: 'state-write', config: { ...target, op: 'add' }, at: [1540, 100] },
    ],
    [
      ['chunk', 'text', 'summarize', 'text'],
      ['summarize', 'text', 'save', 'value'],
      ['chunk', 'link', 'save', 'messages'],
    ],
  );
}

/**
 * "Rolling summaries", two workflows: the narrator, and below it "Summarize history", which condenses every 20 messages
 * older than the newest 16 after the reply into a summary linked to those messages (switch it off per chat in the On
 * reply list); the prompt then carries the summaries plus only the messages none of them stands for. Editing
 * a summarized message makes its summary stop being used until it is summarized again.
 */
export const rollingSummaries: ExamplePack = {
  id: 'rolling-summaries',
  name: 'Rolling summaries (example)',
  collections: () => [],
  definitions: () => [memoryDefinition()],
  presets: () => [narratorPreset(), summarizePreset()],
  workflows: (definitionIds) => [rollingSummariesWorkflow(definitionIds), summarizeWorkflow(definitionIds)],
  uses: { memory: ['summaries'] },
};
