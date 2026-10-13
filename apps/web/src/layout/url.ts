// The layout as a URL: `/?session=S&left=presets&wide=preset:P&right=character:C`. Pure functions only;
// `useLayoutUrl` keeps this in sync with the shell. Everything is optional and the defaults are omitted, so the
// plain chat layout is just `/`. Column widths, dirty flags and drafts never go through the URL.
//
//   session=<id>              the open chat
//   left=workflows|presets|providers|settings
//   left=provider:<id>        a narrow editor open in L
//   wide=workflow|preset[:<id>]   the wide editor in M (the chat then moves to R)
//   right=chats|characters|personas|chat   what R shows ('chat' is only meaningful with a wide editor)
//   right=character:<id>|persona:<id>      a narrow editor open in R
//   edge=<id>                 one-shot: highlight this edge of the opened workflow
import { RESOURCE_IDS, type LayoutState, type LayoutTarget, type ListId, type ResourceId } from './state.js';

export interface LayoutUrl extends Omit<LayoutTarget, 'leftEditorOpen' | 'rightEditorOpen'> {
  session?: string;
  /** The item open in the wide editor. A wide editor without one is not written to the URL. */
  wideId?: string;
  /** The item open in L's narrow editor (L's tab is then that resource). */
  leftId?: string;
  /** The item open in R's narrow editor (R's tab is then that resource). */
  rightId?: string;
  edge?: string;
}

const LEFT_TABS: readonly ListId[] = ['workflows', 'presets', 'providers', 'settings'];
const RIGHT_TABS: readonly (ListId | 'chat')[] = ['chats', 'characters', 'personas', 'chat'];
const WIDE_NAMES: Partial<Record<ResourceId, string>> = { workflows: 'workflow', presets: 'preset' };
const NARROW_NAMES: Partial<Record<ResourceId, string>> = {
  providers: 'provider',
  characters: 'character',
  personas: 'persona',
};

const nameToResource = (names: Partial<Record<ResourceId, string>>, name: string) =>
  RESOURCE_IDS.find((id) => names[id] === name);
const defaultRight = (wide: ResourceId | undefined) => (wide ? 'chat' : 'chats');

/** Splits `name:id` (the id may itself contain colons); the id is undefined when absent or empty. */
function splitItem(value: string): [string, string | undefined] {
  const at = value.indexOf(':');
  if (at < 0) return [value, undefined];
  return [value.slice(0, at), value.slice(at + 1) || undefined];
}

/** Reads a layout from a query string. Unknown or malformed values fall back to the defaults. */
export function parseLayoutUrl(search: string): LayoutUrl {
  const params = new URLSearchParams(search);
  const [wideName, wideId] = splitItem(params.get('wide') ?? '');
  const wide = nameToResource(WIDE_NAMES, wideName);
  // `name:<id>` opens that narrow editor in the column; any other value is a plain tab.
  const column = (param: string) => {
    const [name, item] = splitItem(params.get(param) ?? '');
    const narrow = nameToResource(NARROW_NAMES, name);
    return { tab: narrow && item ? narrow : name, id: narrow ? item : undefined };
  };
  const leftColumn = column('left');
  const rightColumn = column('right');
  const left = leftColumn.tab as ListId;
  const rightTab = rightColumn.tab as ListId | 'chat';
  const right = RIGHT_TABS.includes(rightTab) && (rightTab !== 'chat' || wide) ? rightTab : defaultRight(wide);
  return {
    session: params.get('session') || undefined,
    left: LEFT_TABS.includes(left) ? left : 'workflows',
    right,
    wide,
    wideId: wide ? wideId : undefined,
    leftId: LEFT_TABS.includes(left) ? leftColumn.id : undefined,
    rightId: RIGHT_TABS.includes(rightTab) ? rightColumn.id : undefined,
    edge: params.get('edge') || undefined,
  };
}

/** Writes a layout as a query string (no leading '?'), in a fixed order so equal layouts give equal strings. */
export function formatLayoutUrl(url: LayoutUrl): string {
  const item = (name: string, id?: string) => (id ? `${name}:${encodeURIComponent(id)}` : name);
  const parts: string[] = [];
  if (url.session) parts.push(`session=${encodeURIComponent(url.session)}`);
  const leftName = url.leftId ? NARROW_NAMES[url.left as ResourceId] : undefined;
  if (leftName) parts.push(`left=${item(leftName, url.leftId)}`);
  else if (url.left !== 'workflows') parts.push(`left=${url.left}`);
  if (url.wide) parts.push(`wide=${item(WIDE_NAMES[url.wide] ?? '', url.wideId)}`);
  const narrowName = url.rightId ? NARROW_NAMES[url.right as ResourceId] : undefined;
  if (narrowName) parts.push(`right=${item(narrowName, url.rightId)}`);
  else if (url.right !== defaultRight(url.wide)) parts.push(`right=${url.right}`);
  if (url.edge) parts.push(`edge=${encodeURIComponent(url.edge)}`);
  return parts.join('&');
}

/** Fills the defaults of a partial layout: the base for links and the legacy-path mapping. */
function completeUrl(partial: Partial<LayoutUrl>): LayoutUrl {
  return { left: 'workflows', right: defaultRight(partial.wide), ...partial };
}

/** The query string of a partial layout, e.g. `layoutSearch({ left: 'presets', wide: 'presets', wideId })`. */
export const layoutSearch = (partial: Partial<LayoutUrl>) => formatLayoutUrl(completeUrl(partial));

/** The app link that shows a (partial) layout. The one place link producers build layout URLs. */
export function layoutHref(partial: Partial<LayoutUrl>): string {
  const search = layoutSearch(partial);
  return search ? `/?${search}` : '/';
}

/** What `restore` needs from a parsed URL. */
export const urlTarget = (url: LayoutUrl): LayoutTarget => ({
  left: url.left,
  right: url.right,
  wide: url.wide,
  leftEditorOpen: url.leftId !== undefined,
  rightEditorOpen: url.rightId !== undefined,
});

/**
 * The layout state as a URL. `openIds` are the items the editors report: an editor without an item
 * (still loading, or emptied by a delete) is left out, so the URL never names something that is not open.
 */
export function layoutToUrl(
  state: LayoutState,
  openIds: Partial<Record<ResourceId, string>>,
  session?: string,
): LayoutUrl {
  const wide = state.wide && openIds[state.wide] ? state.wide : undefined;
  const right = state.tabs.R === 'chat' && !wide ? state.rightReturn : state.tabs.R;
  const editing = (tab: ListId | 'chat') =>
    tab !== 'chat' && tab !== 'chats' && state.narrowOpen[tab] ? openIds[tab] : undefined;
  return {
    session,
    left: state.tabs.L,
    right,
    wide,
    wideId: wide && openIds[wide],
    leftId: editing(state.tabs.L),
    rightId: editing(right),
  };
}

/** True when two layouts open the same chat and editor items; only chrome (tabs) differs. */
export function sameContent(a: LayoutUrl, b: LayoutUrl): boolean {
  return (
    a.session === b.session &&
    a.wide === b.wide &&
    a.wideId === b.wideId &&
    a.leftId === b.leftId &&
    a.rightId === b.rightId
  );
}
