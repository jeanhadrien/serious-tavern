import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderModel } from '@st/shared';
import type { NodePanelContext } from './types.js';

export type ModelListState = {
  // `unavailable`: the host gave the panel no loader, so there is no list, only free text.
  status: 'loading' | 'ready' | 'error' | 'unavailable';
  models: ProviderModel[];
  error?: string;
};

const loading: ModelListState = { status: 'loading', models: [] };
const unavailable: ModelListState = { status: 'unavailable', models: [] };

/**
 * Loads a provider's model list when the provider changes, and again on `refresh()` (which asks the server to
 * bypass its cache). A reply that arrives after the provider changed is ignored. Failures never throw: they
 * become `status: 'error'` so the panel can show them inline and typing keeps working.
 */
export function useModelList(providerId: string, loadModels: NodePanelContext['loadModels']) {
  const [state, setState] = useState<ModelListState>(loadModels ? loading : unavailable);
  const latest = useRef(0);
  const load = useCallback(
    (refresh: boolean) => {
      const request = ++latest.current;
      if (!loadModels) {
        setState(unavailable);
        return;
      }
      // A refresh keeps showing the old list meanwhile; a new provider must not show the previous one's.
      setState((previous) => (refresh ? { ...previous, status: 'loading', error: undefined } : loading));
      loadModels(providerId, { refresh }).then(
        (list) => {
          if (request === latest.current) setState({ status: 'ready', models: list.models });
        },
        (error: unknown) => {
          if (request !== latest.current) return;
          const message = error instanceof Error ? error.message : String(error);
          setState((previous) => ({ status: 'error', models: refresh ? previous.models : [], error: message }));
        },
      );
    },
    [providerId, loadModels],
  );
  useEffect(() => {
    load(false);
    // Invalidate the reply still in flight when the provider changes or the panel goes away.
    return () => {
      latest.current++;
    };
  }, [load]);
  return { state, refresh: useCallback(() => load(true), [load]) };
}
