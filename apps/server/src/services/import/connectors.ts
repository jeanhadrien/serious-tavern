import type { ImportApp } from '@st/shared';
import type { ImportConnector } from './connector.js';
import { sillyTavernConnector } from './sillytavern.js';

/** Every connector the server knows, keyed by the app id used in `/api/import-sources/:app`. */
export const connectors: Record<ImportApp, ImportConnector> = {
  sillytavern: sillyTavernConnector,
};
