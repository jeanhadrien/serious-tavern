import { beforeEach, expect, it, vi } from 'vitest';
import type { StateDefinition } from '@st/shared';

const stateDefinitionsApi = { create: vi.fn(), update: vi.fn(), delete: vi.fn() };
const refresh = vi.fn(async () => []);
let listed: { name: string }[] = [];
const open = vi.fn();
const alerts = { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() };
const notifyError = vi.fn();
vi.mock('../../api.js', async (original) => ({ ...(await original<object>()), stateDefinitionsApi }));
vi.mock('../../api/transport.js', async (original) => ({ ...(await original<object>()), notifyError }));
vi.mock('../../stores/index.js', () => ({
  stateDefinitionsStore: { refresh, getSnapshot: () => listed },
  stateDefinitionEditorStore: { open },
}));
vi.mock('../../alerts/index.js', () => ({ alerts }));

const { ApiError } = await import('../../api.js');
const { createStateDefinition, createStateDefinitionFrom, deleteStateDefinition, saveStateDefinition } = await import(
  './stateDefinitionActions.js'
);
const { showStateDefinition, uniqueName } = await import('./stateDefinitionActions.js');

const scene = { id: 'd1', name: 'scene', keys: {} } as unknown as StateDefinition;
const body = { name: 'scene', keys: {} };
beforeEach(() => {
  vi.clearAllMocks();
  listed = [];
});

it('saves silently, refreshes the shared list and tells the user', async () => {
  stateDefinitionsApi.update.mockResolvedValue(scene);
  expect(await saveStateDefinition('d1', body)).toEqual({ kind: 'saved', definition: scene });
  expect(stateDefinitionsApi.update).toHaveBeenCalledWith('d1', body, { silent: true });
  expect(refresh).toHaveBeenCalledOnce();
  expect(alerts.success).toHaveBeenCalledWith('State definition saved');
});

it('answers a taken name inline, without a toast', async () => {
  stateDefinitionsApi.update.mockRejectedValue(
    new ApiError(409, 'STATE_DEFINITION_NAME_TAKEN', 'A state definition named "scene" already exists.'),
  );
  expect(await saveStateDefinition('d1', body)).toEqual({
    kind: 'name-taken',
    message: 'A state definition named "scene" already exists.',
  });
  expect(notifyError).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it('answers a refused rename inline, with the chats that hold state', async () => {
  const sessions = [{ id: 's1', title: 'Tavern night' }];
  stateDefinitionsApi.update.mockRejectedValue(
    new ApiError(409, 'STATE_DEFINITION_IN_USE', "can't be renamed", { sessions, workflows: [] }),
  );
  expect(await saveStateDefinition('d1', body)).toEqual({ kind: 'in-use', message: "can't be renamed", sessions });
  expect(notifyError).not.toHaveBeenCalled();
  // Details that do not parse read as no chats.
  stateDefinitionsApi.update.mockRejectedValue(new ApiError(409, 'STATE_DEFINITION_IN_USE', 'blocked', 'oops'));
  expect(await saveStateDefinition('d1', body)).toEqual({ kind: 'in-use', message: 'blocked', sessions: [] });
});

it('reports any other failure the usual way', async () => {
  const failure = new ApiError(500, 'INTERNAL', 'boom');
  stateDefinitionsApi.update.mockRejectedValue(failure);
  expect(await saveStateDefinition('d1', body)).toEqual({ kind: 'failed' });
  expect(notifyError).toHaveBeenCalledWith(failure);
  expect(alerts.success).not.toHaveBeenCalled();
});

it('creates a definition with a free name, or a copy from a body', async () => {
  listed = [{ name: 'new_state' }, { name: 'New_State2' }];
  stateDefinitionsApi.create.mockResolvedValue(scene);
  expect(await createStateDefinition()).toBe(scene);
  expect(stateDefinitionsApi.create).toHaveBeenCalledWith({ name: 'new_state3', keys: {} });
  expect(alerts.success).not.toHaveBeenCalled();

  expect(await createStateDefinitionFrom(body)).toBe(scene);
  expect(stateDefinitionsApi.create).toHaveBeenLastCalledWith(body);
  expect(alerts.success).toHaveBeenCalledWith('Created "scene"');
  expect(refresh).toHaveBeenCalledTimes(2);

  stateDefinitionsApi.create.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom'));
  expect(await createStateDefinitionFrom(body)).toBeUndefined();
});

it('explains a definition still in use, listing the chats and the workflows', async () => {
  stateDefinitionsApi.delete.mockRejectedValue(
    new ApiError(409, 'STATE_DEFINITION_IN_USE', "can't be deleted", {
      sessions: [
        { id: 's1', title: 'Night one' },
        { id: 's2', title: 'Night two' },
      ],
      workflows: ['Story'],
    }),
  );
  expect(await deleteStateDefinition(scene)).toBe(false);
  expect(stateDefinitionsApi.delete).toHaveBeenCalledWith('d1', { silent: true });
  expect(alerts.error).toHaveBeenCalledOnce();
  expect(alerts.error).toHaveBeenCalledWith(
    expect.stringContaining('"scene" is still in use'),
    expect.objectContaining({
      title: 'State definition in use',
      details: 'Chats: Night one, Night two\nWorkflows: Story',
    }),
  );
  expect(notifyError).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it('tolerates bad in-use details, reports other delete failures, and refreshes after a delete', async () => {
  stateDefinitionsApi.delete.mockRejectedValueOnce(new ApiError(409, 'STATE_DEFINITION_IN_USE', 'blocked', null));
  expect(await deleteStateDefinition(scene)).toBe(false);
  expect(alerts.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ details: 'blocked' }));

  const failure = new ApiError(404, 'NOT_FOUND', 'State definition not found');
  stateDefinitionsApi.delete.mockRejectedValueOnce(failure);
  expect(await deleteStateDefinition(scene)).toBe(false);
  expect(notifyError).toHaveBeenCalledWith(failure);

  stateDefinitionsApi.delete.mockResolvedValueOnce(undefined);
  expect(await deleteStateDefinition(scene)).toBe(true);
  expect(refresh).toHaveBeenCalledOnce();
  expect(alerts.info).toHaveBeenCalledWith('State definition "scene" deleted');
});

it('picks the first free name, ignoring case', () => {
  expect(uniqueName('new_state', [])).toBe('new_state');
  expect(uniqueName('new_state', ['New_State'])).toBe('new_state2');
  expect(uniqueName('new_state', ['new_state', 'new_state2', 'NEW_STATE3'])).toBe('new_state4');
  expect(uniqueName('a', ['b'])).toBe('a');
});

it('opens a definition in the editor as a copy, then shows the editor', () => {
  const show = vi.fn();
  showStateDefinition(scene, show);
  expect(open).toHaveBeenCalledOnce();
  expect(open.mock.calls[0]![0]).toEqual(scene);
  expect(open.mock.calls[0]![0]).not.toBe(scene);
  expect(show).toHaveBeenCalledOnce();
});
