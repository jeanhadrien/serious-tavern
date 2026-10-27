import { join } from 'node:path';
import type { Character, Persona, Workflow, Session, ExecutionLog, ImportSource } from '@st/shared';
import { JsonRepository, type Repository } from './storage/repository.js';
import { KeyedLock } from './storage/lock.js';
import { PresetRepository } from './storage/preset-repository.js';
import { ProviderRepository } from './storage/provider-repository.js';
import { CollectionRepository } from './storage/collection-repository.js';
import { SnippetRepository } from './storage/snippet-repository.js';
import { StateDefinitionRepository } from './storage/state-definition-repository.js';
import { AppSettingsStore } from './storage/app-settings-store.js';
import { migrateJsonPresets } from './storage/preset-migration.js';
import { SecretStore } from './secrets/store.js';
import { seed } from './seed.js';
import { seedStateDefinitions } from './seed-state.js';
import { seedExamples } from './seed-examples.js';
import { TurnRegistry } from './services/turns.js';
import { ModelCatalog } from './services/provider-models.js';
import { ChangeHub, NotifyingRepository, type RecordResource } from './services/change-events.js';

export interface AppContext {
  workflows: NotifyingRepository<Workflow>;
  presets: PresetRepository;
  /** User-defined LLM providers; the built-in ones live in code (see `services/providers.ts`). */
  providers: ProviderRepository;
  /** Authored collections (lorebooks, decks): YAML files under `data/collections/`; read-only for workflows. */
  collections: CollectionRepository;
  /** Snippets: YAML files under `data/snippets/`, named template text every template reads as `{{snippets.<name>}}`. */
  snippets: SnippetRepository;
  /** State definitions: YAML files under `data/state/definitions/` naming what a chat's turns may store. */
  stateDefinitions: StateDefinitionRepository;
  sessions: NotifyingRepository<Session>;
  executions: Repository<ExecutionLog>;
  characters: NotifyingRepository<Character>;
  personas: NotifyingRepository<Persona>;
  importSources: Repository<ImportSource>;
  /** Serializes import syncs per connector, so overlapping syncs cannot create duplicate presets. */
  importLock: KeyedLock;
  characterAvatars: string;
  personaAvatars: string;
  secrets: SecretStore;
  /** The models each provider serves, fetched on demand and cached in memory. */
  modelCatalog: ModelCatalog;
  /** App-wide preferences (`data/app-settings.json`), see `AppSettingsStore`. */
  appSettings: AppSettingsStore;
  turns: TurnRegistry;
  /** Fan-out of resource change events (preset files edited on disk, writes to records) to the open event streams. */
  changes: ChangeHub;
}

export async function createContext(
  dataDir: string,
  options: { seed?: boolean; examples?: boolean },
): Promise<AppContext> {
  const changes = new ChangeHub();
  // Records are wrapped so every write announces itself to the open event streams.
  const notifying = <T extends { id: string }>(name: RecordResource) =>
    new NotifyingRepository(new JsonRepository<T>(join(dataDir, name)), changes, name);
  const workflows = notifying<Workflow>('workflows');
  const presets = new PresetRepository(join(dataDir, 'presets'));
  await migrateJsonPresets(join(dataDir, 'presets'), presets);
  const secrets = new SecretStore(dataDir);
  await secrets.init();
  const stateDefinitions = new StateDefinitionRepository(join(dataDir, 'state', 'definitions'));
  if (options.seed !== false) {
    await seed(workflows, presets);
    await seedStateDefinitions(stateDefinitions);
  }
  // Examples are added for existing data too (see `seedExamples`); the server turns them on, tests ask for them.
  const collections = new CollectionRepository(join(dataDir, 'collections'));
  if (options.examples) await seedExamples({ collections, stateDefinitions, presets, workflows }, dataDir);
  return {
    workflows,
    presets,
    providers: new ProviderRepository(join(dataDir, 'providers')),
    collections,
    snippets: new SnippetRepository(join(dataDir, 'snippets')),
    stateDefinitions,
    sessions: notifying<Session>('sessions'),
    executions: new JsonRepository<ExecutionLog>(join(dataDir, 'executions')),
    characters: notifying<Character>('characters'),
    personas: notifying<Persona>('personas'),
    importSources: new JsonRepository<ImportSource>(join(dataDir, 'import-sources')),
    importLock: new KeyedLock(),
    characterAvatars: join(dataDir, 'avatars', 'characters'),
    personaAvatars: join(dataDir, 'avatars', 'personas'),
    secrets,
    modelCatalog: new ModelCatalog(secrets),
    appSettings: new AppSettingsStore(join(dataDir, 'app-settings.json')),
    turns: new TurnRegistry(),
    changes,
  };
}

export const now = () => new Date().toISOString();
