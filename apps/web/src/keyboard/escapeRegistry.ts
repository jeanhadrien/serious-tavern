import { useEffect, useRef } from 'react';
import type { ViewKey } from '../layout/derive.js';

// Module-level on purpose: Escape is one global rule, and the layers and areas that feed it live in many components.

type Close = () => void;
const layers: Close[] = [];

/** Pushes an open popover's close function; the returned function removes it. */
export function pushLayer(close: Close): () => void {
  layers.push(close);
  return () => {
    const index = layers.lastIndexOf(close);
    if (index >= 0) layers.splice(index, 1);
  };
}

export const layerCount = () => layers.length;

/** Closes the most recently opened layer. Returns false when none is open. */
export function closeNewestLayer(): boolean {
  const close = layers.at(-1);
  close?.();
  return close !== undefined;
}

/**
 * Registers an open popover, menu or card while `open`: Escape closes the newest one first. `close` may change
 * every render; the latest one is used.
 */
export function useEscapeLayer(open: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => (open ? pushLayer(() => latest.current()) : undefined), [open]);
}

/** What Escape does in a layout view; true when it did something. */
export type AreaHandler = () => boolean;

const areas = new Map<ViewKey, { handlers: AreaHandler[]; fallbacks: AreaHandler[] }>();

/** Registers a handler for a view; the returned function removes it. */
export function registerArea(view: ViewKey, handler: AreaHandler, fallback = false): () => void {
  const entry = areas.get(view) ?? { handlers: [], fallbacks: [] };
  areas.set(view, entry);
  const list = fallback ? entry.fallbacks : entry.handlers;
  list.push(handler);
  return () => {
    const index = list.lastIndexOf(handler);
    if (index >= 0) list.splice(index, 1);
  };
}

/**
 * Runs a view's handlers, newest first, until one returns true. Fallbacks (the shell's defaults, registered after
 * the pages' own handlers because a parent's effects run later) are tried after every other handler.
 */
export function runArea(view: ViewKey): boolean {
  const entry = areas.get(view);
  if (!entry) return false;
  for (const handler of [...entry.handlers].reverse()) if (handler()) return true;
  for (const handler of [...entry.fallbacks].reverse()) if (handler()) return true;
  return false;
}

/**
 * Declares what Escape does in a layout view. The handler may change every render; the latest one is used.
 * `fallback` marks the view's default, which runs only when no other handler acted.
 */
export function useEscapeArea(view: ViewKey, handler: AreaHandler, fallback = false) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => registerArea(view, () => latest.current(), fallback), [view, fallback]);
}

interface ViewLike {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/** The view an element is in: the `data-view` of its closest `[data-view]` ancestor (or itself). */
export function areaOf(element: ViewLike | null | undefined): ViewKey | undefined {
  return (element?.closest('[data-view]')?.getAttribute('data-view') as ViewKey | null | undefined) ?? undefined;
}
