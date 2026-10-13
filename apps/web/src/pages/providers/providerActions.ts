import type { ProviderFields, ProviderView } from '@st/shared';
import { ApiError, providersApi } from '../../api.js';
import { notifyError } from '../../api/transport.js';
import { alerts } from '../../alerts/index.js';
import { providersStore } from '../../stores/index.js';

// Provider writes shared by the list and the editor. Each refreshes the shared list, so every view (the list,
// the LLM node's provider dropdown) reads its own write. They resolve with undefined when the request failed
// (already reported to the user).

/** A local OpenAI-compatible server is the most common starting point; the URL is meant to be edited. */
const NEW_PROVIDER: ProviderFields = { name: 'New provider', baseUrl: 'http://localhost:8080/v1' };

async function write<T>(request: () => Promise<T>, done?: string): Promise<T | undefined> {
  try {
    const result = await request();
    await providersStore.refresh().catch(() => {});
    if (done) alerts.success(done);
    return result;
  } catch {
    return undefined; // API errors are toasted.
  }
}

export const createProvider = () => write(() => providersApi.create(NEW_PROVIDER));

export const saveProvider = (id: string, body: ProviderFields) =>
  write(() => providersApi.update(id, body), 'Provider saved');

/** Copies the saved provider (not an unsaved draft) into a new editable one. */
export const duplicateProvider = (provider: ProviderView) =>
  write(() => providersApi.duplicate(provider.id), `Duplicated "${provider.name}"`);

/**
 * Deletes a provider. A provider that LLM nodes still use cannot be deleted: the server answers
 * `PROVIDER_IN_USE` with the workflow names, which are shown with what to do about it. Resolves with success.
 */
export async function deleteProvider(provider: ProviderView): Promise<boolean> {
  try {
    await providersApi.delete(provider.id, { silent: true });
  } catch (error) {
    if (!(error instanceof ApiError)) return false;
    if (error.code === 'PROVIDER_IN_USE') {
      const workflows = Array.isArray(error.details) ? error.details.map(String) : [];
      alerts.error(`"${provider.name}" is still used by LLM nodes, so it was not deleted.`, {
        title: 'Provider in use',
        details: `Point the LLM nodes of these workflows at another provider first:\n${workflows.join('\n')}`,
      });
    } else notifyError(error);
    return false;
  }
  await providersStore.refresh().catch(() => {});
  alerts.info(`Provider "${provider.name}" deleted`);
  return true;
}
