import Fastify from 'fastify';
import { join } from 'node:path';
import { createContext } from './context.js';
import { registerErrors } from './errors.js';
import { MAX_UPLOAD_BYTES } from './uploads.js';
import { registerCharacters } from './routes/characters.js';
import { registerPersonas } from './routes/personas.js';
import { registerPresets } from './routes/presets.js';
import { registerProviders } from './routes/providers.js';
import { registerWorkflows } from './routes/workflows.js';
import { registerSessions } from './routes/sessions.js';
import { registerMessages } from './routes/messages.js';
import { registerExecutions } from './routes/executions.js';
import { registerSecrets } from './routes/secrets.js';
import { registerNodeTypes } from './routes/node-types.js';
import { registerImports } from './routes/imports.js';
import { registerEvents } from './routes/events.js';
import { watchPresetFiles } from './services/change-events.js';

export async function createApp(
  dataDir = join(process.cwd(), 'data'),
  options: { seed?: boolean; watch?: boolean } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: MAX_UPLOAD_BYTES + 256 * 1024 });
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (body.length === 0) return done(null, {});
    parseJson(request, typeof body === 'string' ? body : body.toString('utf8'), done);
  });
  app.addContentTypeParser(/^multipart\/form-data/i, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  app.addContentTypeParser(/^image\/(png|jpeg|gif|webp)$/i, { parseAs: 'buffer' }, (_request, body, done) =>
    done(null, body),
  );
  const context = await createContext(dataDir, options);
  registerNodeTypes(app, context);
  registerCharacters(app, context);
  registerPersonas(app, context);
  registerPresets(app, context);
  registerProviders(app, context);
  registerWorkflows(app, context);
  registerSessions(app, context);
  registerMessages(app, context);
  registerExecutions(app, context);
  registerSecrets(app, context);
  registerImports(app, context);
  registerEvents(app, context);
  registerErrors(app);
  // Watching is opt-in (the server entry point enables it) so ordinary tests do not spawn watchers.
  if (options.watch) {
    const watcher = await watchPresetFiles(context);
    app.addHook('onClose', async () => watcher.close());
  }
  return app;
}
