import type { ChangeEvent, SessionStateView } from '@st/shared';
import { startSessionLoader } from '../sessionLoader.js';

export type StoryLoad = { view: SessionStateView } | { failed: true };

export interface StoryLoaderDeps {
  fetch(sessionId: string): Promise<SessionStateView>;
  subscribe(listener: (event: ChangeEvent) => void): () => void;
  /** How long changes are gathered into one fetch. */
  delayMs?: number;
}

// A saved definition is announced twice (by the API write and, a moment later, by the file watcher): wait for both.
const DEFINITION_RELOAD_DELAY_MS = 300;

/**
 * Keeps one chat's story state view fresh (see `startSessionLoader`): it also reloads on `stateDefinitions.changed`,
 * waiting longer for it.
 */
export function startStoryLoader(
  sessionId: string,
  { fetch, subscribe, delayMs }: StoryLoaderDeps,
  onResult: (result: StoryLoad) => void,
): { reload(): void; stop(): void } {
  return startSessionLoader(
    sessionId,
    { fetch, subscribe, delayMs, alsoOn: { 'stateDefinitions.changed': DEFINITION_RELOAD_DELAY_MS } },
    (result) => onResult('value' in result ? { view: result.value } : result),
  );
}
