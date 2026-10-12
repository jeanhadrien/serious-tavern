import { createApp } from './app.js';
const app = await createApp(undefined, { watch: true });
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '127.0.0.1' });
console.log('Server listening on http://localhost:3001');
