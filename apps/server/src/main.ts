import { createApp } from './app.js';
const app = await createApp(undefined, { watch: true, examples: true });
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '127.0.0.1' });
console.log('Server listening on http://localhost:3001');
// Close the watcher and the open event streams before exiting.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().finally(() => process.exit(0)));
}
