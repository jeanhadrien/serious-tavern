import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useLayoutActions } from '../../layout/LayoutActions.js';
import { panelLinkTarget } from '../../layout/routes.js';
import { openCollection } from '../collections/collectionActions.js';
import { openStateDefinition } from '../stateDefinitions/stateDefinitionActions.js';

/** A plain left click; modified clicks (new tab, new window) keep the browser's behaviour. */
const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * A link from a node config panel (node-ui's `renderLink`). A collection opens in R and a state definition in L
 * next to the workflow being edited, like a click in their lists (`panelLinkTarget`);
 * other links route through their URL.
 */
export function PanelLink({ to, label }: { to: string; label: string }) {
  const { openEditor } = useLayoutActions();
  const open = (event: MouseEvent) => {
    if (!plainClick(event)) return;
    const target = panelLinkTarget(to);
    if (target?.kind === 'collection') void openCollection(target.id, () => openEditor('collections'));
    else if (target?.kind === 'stateDefinition')
      void openStateDefinition(target.id, () => openEditor('stateDefinitions'));
    else return;
    event.preventDefault();
  };
  return (
    <Link to={to} onClick={open}>
      {label}
    </Link>
  );
}
