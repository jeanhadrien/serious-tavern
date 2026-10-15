import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { collectionEditorStore, collectionsStore } from '../../stores/index.js';

/** The collection a node panel link points at (`/collections?id=<id>`), if any. */
function collectionId(to: string): string | undefined {
  const url = new URL(to, 'http://app');
  return url.pathname === '/collections' ? url.searchParams.get('id') || undefined : undefined;
}

/**
 * A link from a node config panel (node-ui's `renderLink`). A collection opens in R next to the workflow being
 * edited, like a click in the collections list; following the link's URL would replace the whole layout and
 * close the workflow. Other links (and collections the list does not know) route through their URL.
 */
export function PanelLink({ to, label }: { to: string; label: string }) {
  const { openEditor } = useLayoutActions();
  const open = (event: MouseEvent) => {
    const id = collectionId(to);
    const item = id && collectionsStore.getSnapshot().find((collection) => collection.id === id);
    if (!item) return;
    event.preventDefault();
    collectionEditorStore.open(structuredClone(item));
    openEditor('collections');
  };
  return (
    <Link to={to} onClick={open}>
      {label}
    </Link>
  );
}
