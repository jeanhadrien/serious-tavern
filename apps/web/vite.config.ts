import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` picks free ports for each instance: WEB_PORT for this server and PORT for the API it proxies to.
const apiPort = process.env.PORT ?? 3001;
const webPort = process.env.WEB_PORT;
export default defineConfig({
  plugins: [react()],
  server: {
    ...(webPort && { port: Number(webPort), strictPort: true }),
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
});
