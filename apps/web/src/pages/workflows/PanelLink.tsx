import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { collectionLinkId } from '../../layout/routes.js';
import { openCollection } from '../collections/collectionActions.js';

/** A plain left click; modified clicks (new tab, new window) keep the browser's behaviour. */
const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * A link from a node config panel (node-ui's `renderLink`). A collection opens in R next to the workflow being
 * edited, like a click in the collections list (`collectionLinkId`); other links route through their URL.
 */
export function PanelLink({ to, label }: { to: string; label: string }) {
  const { openEditor } = useLayoutActions();
  const open = (event: MouseEvent) => {
    const id = collectionLinkId(to);
    if (!id || !plainClick(event)) return;
    event.preventDefault();
    void openCollection(id, () => openEditor('collections'));
  };
  return (
    <Link to={to} onClick={open}>
      {label}
    </Link>
  );
}
