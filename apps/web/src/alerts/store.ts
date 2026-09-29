export type AlertLevel = 'error' | 'success' | 'info' | 'warning';
export type Alert = {
  id: string;
  level: AlertLevel;
  title?: string;
  message: string;
  details?: string;
  createdAt: number;
  timeoutMs: number;
  count: number;
};
export type AlertOptions = { title?: string; details?: string; timeoutMs?: number };

const defaults: Record<AlertLevel, number> = { error: 0, success: 4000, info: 4000, warning: 4000 };

export class AlertStore {
  private items: Alert[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly deadlines = new Map<string, number>();
  private readonly remaining = new Map<string, number>();
  private readonly lastSeen = new Map<string, number>();

  getSnapshot = (): Alert[] => this.items;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify() {
    for (const listener of this.listeners) listener();
  }
  private key(alert: Pick<Alert, 'level' | 'title' | 'message' | 'details'>) {
    return JSON.stringify([alert.level, alert.title, alert.message, alert.details]);
  }
  private cancel(id: string) {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
    this.deadlines.delete(id);
  }
  private schedule(id: string, duration: number) {
    this.cancel(id);
    if (duration <= 0) {
      this.remaining.delete(id);
      return;
    }
    this.deadlines.set(id, Date.now() + duration);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), duration),
    );
  }
  add(level: AlertLevel, message: string, options: AlertOptions = {}): string {
    const now = Date.now();
    const candidate = { level, title: options.title, message, details: options.details };
    const key = this.key(candidate);
    const duplicate = this.items.find(
      (item) => this.key(item) === key && now - (this.lastSeen.get(item.id) ?? 0) < 2000,
    );
    if (duplicate) {
      this.lastSeen.set(duplicate.id, now);
      this.items = this.items.map((item) => (item.id === duplicate.id ? { ...item, count: item.count + 1 } : item));
      if (!this.remaining.has(duplicate.id)) this.schedule(duplicate.id, duplicate.timeoutMs);
      this.notify();
      return duplicate.id;
    }
    const alert: Alert = {
      id: crypto.randomUUID(),
      ...candidate,
      createdAt: now,
      timeoutMs: options.timeoutMs ?? defaults[level],
      count: 1,
    };
    if (this.items.length >= 5) this.dismiss(this.items[0]!.id);
    this.items = [...this.items, alert];
    this.lastSeen.set(alert.id, now);
    this.schedule(alert.id, alert.timeoutMs);
    this.notify();
    return alert.id;
  }
  error = (message: string, options?: AlertOptions) => this.add('error', message, options);
  success = (message: string, options?: AlertOptions) => this.add('success', message, options);
  info = (message: string, options?: AlertOptions) => this.add('info', message, options);
  warning = (message: string, options?: AlertOptions) => this.add('warning', message, options);
  pause = (id: string) => {
    const deadline = this.deadlines.get(id);
    if (deadline === undefined) return;
    this.remaining.set(id, Math.max(1, deadline - Date.now()));
    this.cancel(id);
  };
  resume = (id: string) => {
    const remaining = this.remaining.get(id);
    if (remaining === undefined) return;
    this.remaining.delete(id);
    this.schedule(id, remaining);
  };
  dismiss = (id: string) => {
    this.cancel(id);
    this.remaining.delete(id);
    this.lastSeen.delete(id);
    if (!this.items.some((item) => item.id === id)) return;
    this.items = this.items.filter((item) => item.id !== id);
    this.notify();
  };
  clear = () => {
    for (const item of this.items) this.cancel(item.id);
    this.remaining.clear();
    this.lastSeen.clear();
    this.items = [];
    this.notify();
  };
}

export const alerts = new AlertStore();
