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
  useLayoutEffect(() => {
    if (!content.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(stick);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  return {
    viewport,
    content,
    onScroll: () => {
      if (viewport.current) nearBottom.current = isNearBottom(viewport.current);
    },
  };
}
