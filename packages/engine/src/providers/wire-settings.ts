import type { Provider } from '@st/shared';

/** How one request is spelled on the wire: a provider record with its matching override applied. */
export type WireSettings = {
  headers: Record<string, string>;
  // Wire field for a message's name; null drops names.
  messageName: string | null;
  reasoningFields: string[];
  extraBody: Record<string, unknown>;
};

// Model-id glob: `*` matches any run of characters (including `/`), everything else is literal.
function globMatches(pattern: string, model: string) {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(model);
}

/**
 * Resolves the wire settings of `provider` for `model`. The first override whose `match` fits the model id
 * replaces `messageName`/`reasoningFields` and shallow-merges its `headers`/`extraBody` over the provider's.
 */
export function resolveWireSettings(provider: Provider, model: string): WireSettings {
  const override = provider.overrides.find((candidate) => globMatches(candidate.match, model));
  return {
    headers: { ...provider.headers, ...override?.headers },
    // An override's explicit null ("never send names") must win, so this is not `??`.
    messageName: override?.messageName !== undefined ? override.messageName : provider.messageName,
    reasoningFields: override?.reasoningFields ?? provider.reasoningFields,
    extraBody: { ...provider.extraBody, ...override?.extraBody },
  };
}
