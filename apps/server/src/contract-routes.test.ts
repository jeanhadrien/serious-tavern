import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { apiContract, type ApiEndpoint } from '@st/shared';
import { createApp } from './app.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('serves every contract endpoint at its method and path, and nothing else under /api', async () => {
  const directory = join(process.cwd(), '.test-data', `test-${randomUUID()}`);
  directories.push(directory);
  const app = await createApp(directory, { seed: false });
  try {
    for (const key of Object.keys(apiContract) as ApiEndpoint[]) {
      const { method, path } = apiContract[key];
      expect(app.hasRoute({ method, url: path }), `${key}: ${method} ${path}`).toBe(true);
    }
    // A route registered around `route()` is refused when it is added.
    expect(() => app.get('/api/not-in-the-contract', async () => 'x')).toThrow(/not registered through route/);
  } finally {
    await app.close();
  }
});
