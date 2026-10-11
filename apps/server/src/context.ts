import { join } from 'node:path';
import type { Character, Persona, Preset, Workflow, Session, ExecutionLog } from '@st/shared';
import { JsonRepository, type Repository } from './storage/repository.js';
import { SecretStore } from './secrets/store.js';
import { seed } from './seed.js';
import { TurnRegistry } from './services/turns.js';

export interface AppContext {
  workflows: Repository<Workflow>;
  presets: Repository<Preset>;
  sessions: Repository<Session>;
  executions: Repository<ExecutionLog>;
  characters: Repository<Character>;
  personas: Repository<Persona>;
  characterAvatars: string;
  personaAvatars: string;
  secrets: SecretStore;
  turns: TurnRegistry;
}

export async function createContext(dataDir: string, options: { seed?: boolean }): Promise<AppContext> {
  const workflows = new JsonRepository<Workflow>(join(dataDir, 'workflows'));
  const presets = new JsonRepository<Preset>(join(dataDir, 'presets'));
  const secrets = new SecretStore(dataDir);
  await secrets.init();
  if (options.seed !== false) await seed(workflows, presets);
  return {
    workflows,
    presets,
    sessions: new JsonRepository<Session>(join(dataDir, 'sessions')),
    executions: new JsonRepository<ExecutionLog>(join(dataDir, 'executions')),
    characters: new JsonRepository<Character>(join(dataDir, 'characters')),
    personas: new JsonRepository<Persona>(join(dataDir, 'personas')),
    characterAvatars: join(dataDir, 'avatars', 'characters'),
    personaAvatars: join(dataDir, 'avatars', 'personas'),
    secrets,
    turns: new TurnRegistry(),
  };
}

export const now = () => new Date().toISOString();
