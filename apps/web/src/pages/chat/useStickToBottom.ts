import { useLayoutEffect, useRef } from 'react';

export function isNearBottom(
  {
    scrollHeight,
    scrollTop,
    clientHeight,
  }: {
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
  },
  threshold = 96,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function shouldStickToBottom(sessionChanged: boolean, nearBottom: boolean): boolean {
  return sessionChanged || nearBottom;
}

type Observer = new (callback: () => void) => Pick<ResizeObserver, 'observe' | 'disconnect'>;

/**
 * Calls `onResize` whenever one of the elements changes size; returns the function that stops watching. The thread
 * watches both its content (it grows with messages, images, details) and its own viewport: a row appearing between
 * the thread and the composer shrinks the viewport, and the newest message would be clipped behind it otherwise.
 */
export function watchResize(
  elements: readonly (Element | null)[],
  onResize: () => void,
  Observer: Observer | undefined = globalThis.ResizeObserver,
): () => void {
  if (!Observer) return () => {};
  const observer = new Observer(onResize);
  for (const element of elements) if (element) observer.observe(element);
  return () => observer.disconnect();
}

export function useStickToBottom(sessionId: string, revision: unknown) {
  const viewport = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const previousSession = useRef<string | undefined>(undefined);
  const nearBottom = useRef(true);
  const stick = () => {
    const element = viewport.current;
    if (element && nearBottom.current) element.scrollTop = element.scrollHeight;
  };
  useLayoutEffect(() => {
    const changed = previousSession.current !== sessionId;
    if (shouldStickToBottom(changed, nearBottom.current)) {
      nearBottom.current = true;
      stick();
    }
    previousSession.current = sessionId;
  }, [sessionId, revision]);
  useLayoutEffect(() => watchResize([content.current, viewport.current], stick), []);
  return {
    viewport,
    content,
    onScroll: () => {
      if (viewport.current) nearBottom.current = isNearBottom(viewport.current);
    },
  };
}
