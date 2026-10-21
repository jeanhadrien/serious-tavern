// `npm run dev`: the server and the web app, on ports no other running instance holds, so every checkout (the main
// one and each git worktree) can run its own copy side by side.
//
// - Ports: the first free one from PORT (default 3001) for the server and from WEB_PORT (default 5173) for the web
//   app. The web app's `/api` proxy follows the server's port (`apps/web/vite.config.ts`).
// - Data: DATA_DIR if set. A git worktree otherwise uses the main checkout's `apps/server/data`, so a branch under test
//   sees the real providers and chats. A plain checkout keeps `./data` under `apps/server`.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import concurrently from 'concurrently';

const HOST = '127.0.0.1';

/** Whether nothing listens on the port. Both servers bind 127.0.0.1, so that is the address to probe. */
const isFree = (port) =>
  new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, HOST, () => probe.close(() => done(true)));
  });

async function freePort(from, taken = []) {
  for (let port = from; ; port++) if (!taken.includes(port) && (await isFree(port))) return port;
}

/** The main checkout's data folder when this is a linked git worktree, else undefined. */
function mainCheckoutData() {
  try {
    const git = (flag) =>
      execFileSync('git', ['rev-parse', '--path-format=absolute', flag], { encoding: 'utf8' }).trim();
    const common = resolve(git('--git-common-dir'));
    if (common === resolve(git('--git-dir'))) return undefined;
    const data = join(dirname(common), 'apps', 'server', 'data');
    return existsSync(data) ? data : undefined;
  } catch {
    return undefined; // not a git checkout, or no git
  }
}

const port = await freePort(Number(process.env.PORT ?? 3001));
const webPort = await freePort(Number(process.env.WEB_PORT ?? 5173), [port]);
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : mainCheckoutData();
const env = { PORT: String(port), WEB_PORT: String(webPort), ...(dataDir && { DATA_DIR: dataDir }) };

console.log(`\n  Web:    http://${HOST}:${webPort}\n  Server: http://${HOST}:${port}`);
console.log(`  Data:   ${dataDir ?? 'apps/server/data (this checkout)'}\n`);

const { result } = concurrently(
  [
    { name: 'server', command: 'npm run dev -w @st/server', env },
    { name: 'web', command: 'npm run dev -w @st/web', env },
  ],
  { killOthersOn: ['failure'] },
);
await result.catch(() => process.exit(1));
