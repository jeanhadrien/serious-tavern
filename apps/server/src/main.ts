import { resolve } from 'node:path';
import { createApp } from './app.js';
// PORT and DATA_DIR let several instances run side by side (`npm run dev` sets them); the defaults are 3001 and `./data`.
const port = Number(process.env.PORT ?? 3001);
const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const app = await createApp(dataDir, { watch: true, examples: true });
await app.listen({ port, host: '127.0.0.1' });
console.log(`Server listening on http://127.0.0.1:${port}, data in ${dataDir}`);
// Close the watcher and the open event streams before exiting.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().finally(() => process.exit(0)));
}
