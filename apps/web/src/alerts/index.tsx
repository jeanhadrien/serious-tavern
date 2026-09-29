import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { alerts, type AlertStore } from './store.js';

const AlertsContext = createContext<AlertStore>(alerts);
export function AlertsProvider({ children }: { children: ReactNode }) {
  return <AlertsContext.Provider value={alerts}>{children}</AlertsContext.Provider>;
}
export function useAlerts() {
  const store = useContext(AlertsContext);
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { items, alerts: store };
}
export { alerts } from './store.js';
