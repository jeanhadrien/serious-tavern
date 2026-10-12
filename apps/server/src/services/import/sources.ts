import { resolve } from 'node:path';
import { importSourceSchema, type ImportSource } from '@st/shared';
import type { AppContext } from '../../context.js';
import type { ImportConnector } from './connector.js';

/** Stores the install folder for a connector, after checking that it is a usable install. */
export async function setImportSourcePath(
  { importSources }: Pick<AppContext, 'importSources'>,
  connector: ImportConnector,
  path: string,
): Promise<ImportSource> {
  const installPath = resolve(path);
  await connector.detect(installPath);
  const updated = await importSources.update(connector.app, (old) => ({ ...old, path: installPath }));
  if (updated) return updated;
  const created = importSourceSchema.parse({ id: connector.app, app: connector.app, path: installPath });
  await importSources.save(created);
  return created;
}
