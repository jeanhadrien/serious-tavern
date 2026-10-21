import type { ApiEndpoint } from '@st/shared';

/**
 * What the MCP does with one API endpoint:
 * - `'expose'` becomes a tool;
 * - `'readonly'` becomes a tool flagged read-only for clients (a GET always is; this is for a POST that only reads);
 * - `{ skip }` stays out, with the reason.
 */
type ExposeEntry = 'expose' | 'readonly' | { skip: string };

const skip = (reason: string): ExposeEntry => ({ skip: reason });
const notInV1 = skip('Not part of v1.');
const noDeletes = skip('Deleting is left to the app in v1.');
const binary = skip('Binary body or response, which does not fit a JSON tool.');
const chats = skip('Chats are driven from the app: the MCP edits the building blocks, not conversations.');
const neverExposed = skip('Secrets are never exposed to agents.');

/**
 * The only per-endpoint code of the MCP. Typed against the whole contract: adding an endpoint fails typecheck here
 * until someone decides whether agents get it. Everything else (tool name, description, input schema, the HTTP call)
 * is derived from the contract entry.
 */
export const exposeMap: Record<ApiEndpoint, ExposeEntry> = {
  // Presets
  listPresets: 'expose',
  getPreset: 'expose',
  createPreset: 'expose',
  updatePreset: 'expose',
  previewPreset: 'readonly',
  deletePreset: noDeletes,

  // Workflows and node types
  listWorkflows: 'expose',
  getWorkflow: 'expose',
  createWorkflow: 'expose',
  updateWorkflow: 'expose',
  validateWorkflow: 'readonly',
  deleteWorkflow: noDeletes,
  listNodeTypes: 'expose',
  getNodeType: 'expose',
  resolvePorts: 'readonly',

  // Characters and personas
  listCharacters: 'expose',
  getCharacter: 'expose',
  createCharacter: 'expose',
  updateCharacter: 'expose',
  deleteCharacter: noDeletes,
  importCharacters: binary,
  getCharacterAvatar: binary,
  updateCharacterAvatar: binary,
  exportCharacter: binary,
  listPersonas: 'expose',
  getPersona: 'expose',
  createPersona: 'expose',
  updatePersona: 'expose',
  deletePersona: noDeletes,
  importPersonas: binary,
  getPersonaAvatar: binary,
  updatePersonaAvatar: binary,

  // Read-only: providers and their models, state definitions, collections
  listProviders: 'expose',
  getProvider: 'expose',
  listProviderModels: 'expose',
  createProvider: neverExposed,
  updateProvider: neverExposed,
  deleteProvider: neverExposed,
  duplicateProvider: neverExposed,
  listStateDefinitions: 'expose',
  getStateDefinition: 'expose',
  createStateDefinition: notInV1,
  updateStateDefinition: notInV1,
  deleteStateDefinition: noDeletes,
  listCollections: 'expose',
  getCollection: 'expose',
  createCollection: notInV1,
  updateCollection: notInV1,
  deleteCollection: noDeletes,

  // Secrets, settings, imports
  listSecrets: neverExposed,
  setSecret: neverExposed,
  deleteSecret: neverExposed,
  getAppSettings: notInV1,
  updateAppSettings: notInV1,
  listImportSources: notInV1,
  setImportSource: notInV1,
  syncImportSource: notInV1,

  // Chats, turns and live events
  listSessions: chats,
  createSession: chats,
  getSession: chats,
  updateSession: chats,
  deleteSession: chats,
  sendMessage: chats,
  streamTurn: chats,
  regenerate: chats,
  streamRegenerate: chats,
  setAlternative: chats,
  forkSession: chats,
  stopTurn: chats,
  updateMessage: chats,
  deleteMessage: chats,
  getExecution: chats,
  getSessionState: chats,
  getSessionStats: chats,
  streamChanges: skip('A server-sent event stream, not a request and response.'),
};
