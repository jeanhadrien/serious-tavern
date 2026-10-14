import { adapters, missingSecretMessage } from '@st/engine';
import type { ProviderModel, ProviderModelList, ProviderView } from '@st/shared';
import { errorMessage, HttpError } from '../errors.js';
import type { SecretStore } from '../secrets/store.js';

// Backends add models rarely; an hour keeps the picker fast without going stale for a day.
const ttlMs = 60 * 60 * 1000;

type Entry = ProviderModelList & { version: string; expiresAt: number };

// What the API answers: the entry without its bookkeeping.
const listOf = ({ models, fetchedAt }: Entry): ProviderModelList => ({ models, fetchedAt });

/**
 * Per-provider model lists fetched through the provider's adapter, kept in memory only (a restart refetches).
 * A list is stale once it is older than the TTL, once the provider record changed, or once any secret was
 * written or deleted. Concurrent requests for the same provider share one fetch; failures are never cached.
 */
export class ModelCatalog {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, { version: string; promise: Promise<Entry> }>();

  constructor(private readonly secrets: SecretStore) {}

  async list(provider: ProviderView, refresh: boolean): Promise<ProviderModelList> {
    // The whole record, not `updatedAt`: files edited by hand on disk keep their old timestamp.
    const version = `${this.secrets.revision}:${JSON.stringify(provider)}`;
    const cached = this.entries.get(provider.id);
    if (!refresh && cached?.version === version && cached.expiresAt > Date.now()) return listOf(cached);
    const running = this.pending.get(provider.id);
    if (running?.version === version) return listOf(await running.promise);
    const promise = this.fetch(provider, version);
    this.pending.set(provider.id, { version, promise });
    try {
      const entry = await promise;
      this.entries.set(provider.id, entry);
      return listOf(entry);
    } finally {
      // A newer fetch for a changed record may already have replaced this one.
      if (this.pending.get(provider.id)?.promise === promise) this.pending.delete(provider.id);
    }
  }

  private async fetch(provider: ProviderView, version: string): Promise<Entry> {
    const adapter = adapters.get(provider.kind);
    if (!adapter?.listModels)
      throw new HttpError(
        501,
        'PROVIDER_MODELS_UNSUPPORTED',
        `"${provider.name}" cannot list models (${provider.kind})`,
      );
    // A provider without a secret (a local server) is called without credentials, as when running an LLM node.
    const apiKey = provider.secret ? await this.secrets.get(provider.secret) : undefined;
    if (provider.secret && !apiKey)
      throw new HttpError(400, 'PROVIDER_SECRET_MISSING', missingSecretMessage(provider.secret));
    let models: ProviderModel[];
    try {
      // No request signal: the fetch is shared between requests and bounded by the adapter's own timeout.
      models = await adapter.listModels({ provider, apiKey, signal: new AbortController().signal });
    } catch (error) {
      throw new HttpError(502, 'PROVIDER_MODELS_FAILED', errorMessage(error));
    }
    return { models, fetchedAt: new Date().toISOString(), version, expiresAt: Date.now() + ttlMs };
  }
}
