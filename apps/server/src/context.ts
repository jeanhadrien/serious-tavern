import { join } from 'node:path';
import type { Character, Persona, Workflow, Session, ExecutionLog, ImportSource } from '@st/shared';
import { JsonRepository, type Repository } from './storage/repository.js';
import { KeyedLock } from './storage/lock.js';
import { PresetRepository } from './storage/preset-repository.js';
import { ProviderRepository } from './storage/provider-repository.js';
import { migrateJsonPresets } from './storage/preset-migration.js';
import { SecretStore } from './secrets/store.js';
import { seed } from './seed.js';
import { TurnRegistry } from './services/turns.js';
import { ChangeHub, NotifyingRepository, type RecordResource } from './services/change-events.js';

export interface AppContext {
  workflows: NotifyingRepository<Workflow>;
  presets: PresetRepository;
  /** User-defined LLM providers; the built-in ones live in code (see `services/providers.ts`). */
  providers: ProviderRepository;
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
  turns: TurnRegistry;
  /** Fan-out of resource change events (preset files edited on disk, writes to records) to the open event streams. */
  changes: ChangeHub;
}

export async function createContext(dataDir: string, options: { seed?: boolean }): Promise<AppContext> {
  const changes = new ChangeHub();
  // Records are wrapped so every write announces itself to the open event streams.
  const notifying = <T extends { id: string }>(name: RecordResource) =>
    new NotifyingRepository(new JsonRepository<T>(join(dataDir, name)), changes, name);
  const workflows = notifying<Workflow>('workflows');
  const presets = new PresetRepository(join(dataDir, 'presets'));
  await migrateJsonPresets(join(dataDir, 'presets'), presets);
  const secrets = new SecretStore(dataDir);
  await secrets.init();
  if (options.seed !== false) await seed(workflows, presets);
  return {
    workflows,
    presets,
    providers: new ProviderRepository(join(dataDir, 'providers')),
    sessions: notifying<Session>('sessions'),
    executions: new JsonRepository<ExecutionLog>(join(dataDir, 'executions')),
    characters: notifying<Character>('characters'),
    personas: notifying<Persona>('personas'),
    importSources: new JsonRepository<ImportSource>(join(dataDir, 'import-sources')),
    importLock: new KeyedLock(),
    characterAvatars: join(dataDir, 'avatars', 'characters'),
    personaAvatars: join(dataDir, 'avatars', 'personas'),
    secrets,
    turns: new TurnRegistry(),
    changes,
  };
}

export const now = () => new Date().toISOString();
