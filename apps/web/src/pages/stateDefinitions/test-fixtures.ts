import type { StateDefinition } from '@st/shared';

// Test fixtures shared by the definition editor tests.
export const definition = (extra: Partial<StateDefinition> = {}): StateDefinition => ({
  id: '4c8f7d0e-34a3-4c7b-9b1f-6a3f0f2bb0a1',
  name: 'scene',
  description: 'The scene so far',
  keys: {
    tension: { type: 'number', default: 3, min: 0, max: 10 },
    level: { type: 'number', default: 0, min: 0 },
    quiet: { type: 'boolean', default: false },
    mood: { type: 'enum', options: ['calm', 'tense'], default: 'tense' },
    place: { type: 'text', default: 'a tavern' },
    flags: { type: 'object', default: { a: 1 }, schema: { a: 'number' }, 'x-note': 'keep me' },
    injected: { type: 'collection', cap: 30, fields: { level: 'number' } },
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});
