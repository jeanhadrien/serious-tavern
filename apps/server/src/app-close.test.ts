import { afterEach, expect, it, vi } from 'vitest';
import { TurnRegistry } from './services/turns.js';
import { tempApps } from './test-support/story.js';

const apps = tempApps('app-close');
afterEach(async () => {
  vi.restoreAllMocks();
  await apps.cleanup();
});

it('stops and waits for the running jobs of the turn registry when the app closes', async () => {
  const { app } = await apps.open();
  const close = vi.spyOn(TurnRegistry.prototype, 'close');
  await app.close();
  expect(close).toHaveBeenCalledOnce();
});
