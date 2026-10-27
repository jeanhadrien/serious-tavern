import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import type { Session } from '@st/shared';
import {
  characterEditorStore,
  collectionEditorStore,
  personaEditorStore,
  presetEditorStore,
  providerEditorStore,
  sessionsStore,
  snippetEditorStore,
  stateDefinitionEditorStore,
  workflowEditorStore,
  type WorkflowFocus,
} from '../stores/index.js';
import type { EditorStore } from '../stores/editorStore.js';
import { ITEM_SOURCES, type Item } from './itemSources.js';
import { legacySearch } from './routes.js';
import type { LayoutAction, LayoutState, ResourceId } from './state.js';
import {
  formatLayoutUrl,
  layoutToUrl,
  parseLayoutUrl,
  phoneEditorLoading,
  sameContent,
  urlTarget,
  type LayoutUrl,
} from './url.js';

/** What the hook needs from the chat; `busy` turns must never be disturbed. */
interface ChatControls {
  session?: Session;
  busy: boolean;
  open(id: string): Promise<void>;
  close(): void;
}

const EDITOR_TIMEOUT_MS = 4000;

/** Resolves once the editor reports `id` as open (or after a timeout, so a stuck editor cannot block the URL). */
function whenOpen(editor: EditorStore<Item, unknown>, id: string): Promise<void> {
  return new Promise((resolve) => {
    let stop = () => {};
    const done = () => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(done, EDITOR_TIMEOUT_MS);
    stop = editor.subscribe(() => editor.getSnapshot().currentId === id && done());
    if (editor.getSnapshot().currentId === id) done();
  });
}

const useOpenId = (editor: EditorStore<Item, unknown>) =>
  useSyncExternalStore(editor.subscribe, () => editor.getSnapshot().currentId);

/** The layout state that comes from a URL's query; used to build the shell's initial state. */
export const searchOf = (pathname: string, search: string) =>
  pathname === '/' ? search.replace(/^\?/, '') : legacySearch(pathname, search);

/**
 * Keeps the URL and the shell in step, in both directions.
 *
 * - Layout to URL: whenever the layout, the open editor items or the open chat change, the URL is rewritten.
 *   A change of content (chat, editor, item) is a `push`, so browser Back steps through what the user opened;
 *   tab switches are `replace`, since they are not places worth going Back to.
 * - URL to layout: a URL we did not write (Back/Forward, a pasted or clicked link, a legacy path) is applied to the
 *   layout, and its items are opened once their lists are loaded. Ids that no longer exist close their editor;
 *   an editor with unsaved changes keeps its draft; a streaming chat is never switched. While that runs the URL is
 *   not rewritten, and afterwards the real state is written back with `replace`, so the URL always describes what
 *   is on screen.
 */
export function useLayoutUrl(layout: LayoutState, dispatch: Dispatch<LayoutAction>, chat: ChatControls) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // The query last written to, or applied from, the URL. Location changes that match it are our own.
  const synced = useRef(searchOf(pathname, search));
  // True from the moment a URL is applied until its items are open; the URL is not rewritten meanwhile.
  const applying = useRef(true);
  const forceReplace = useRef(false);
  const generation = useRef(0);
  const [settled, setSettled] = useState(0);

  const apply = async (url: LayoutUrl, fromHistory: boolean) => {
    const current = ++generation.current;
    applying.current = true;
    const isCurrent = () => generation.current === current;
    const openItem = async (resource: ResourceId, id: string, focus?: WorkflowFocus) => {
      const source = ITEM_SOURCES[resource];
      if (!source) return;
      const open = source.editor.getSnapshot();
      if (open.currentId === id && !focus) return;
      // Back/Forward never discards an unsaved draft (the URL then follows what is shown); a clicked link,
      // like a click in a list, asks Save / Discard / Cancel first. Cancel leaves the editor alone and the URL is
      // then written back to what is shown.
      if (fromHistory && open.dirty && open.currentId !== id) return;
      const items = await source.list.refresh().catch(() => undefined);
      if (!items || !isCurrent()) return;
      const item = items.find((candidate) => candidate.id === id);
      if (!item) return dispatch({ type: 'closeEditor', id: resource }); // deleted since the link was made
      if (!(await source.editor.confirmSwitch(id)) || !isCurrent()) return;
      source.editor.open(structuredClone(item), focus);
      await whenOpen(source.editor, id);
    };
    const openSession = async (id: string | undefined) => {
      if (chatRef.current.session?.id === id || chatRef.current.busy) return;
      // A link without a chat leaves the open one alone; only stepping through history closes it.
      if (!id) return fromHistory ? chatRef.current.close() : undefined;
      const sessions = await sessionsStore.refresh().catch(() => undefined);
      if (sessions?.some((session) => session.id === id) && isCurrent()) await chatRef.current.open(id);
    };
    await Promise.all([
      url.wide && url.wideId
        ? openItem(url.wide, url.wideId, url.edge || url.node ? { edge: url.edge, node: url.node } : undefined)
        : undefined,
      url.leftId ? openItem(url.left as ResourceId, url.leftId) : undefined,
      url.rightId ? openItem(url.right as ResourceId, url.rightId) : undefined,
      openSession(url.session),
    ]);
    if (!isCurrent()) return;
    applying.current = false;
    forceReplace.current = true; // corrections (stale ids, kept drafts) must not add history entries
    setSettled((count) => count + 1);
  };

  // URL to layout.
  const mounted = useRef(false);
  useEffect(() => {
    const incoming = searchOf(pathname, search);
    if (pathname !== '/') navigate({ pathname: '/', search: incoming }, { replace: true });
    if (mounted.current && incoming === synced.current) return;
    const first = !mounted.current;
    mounted.current = true;
    synced.current = incoming;
    const url = parseLayoutUrl(incoming);
    // The initial layout was already built from the URL; only later URLs need restoring.
    if (!first) dispatch({ type: 'restore', target: urlTarget(url) });
    void apply(url, navigationType === 'POP');
  }, [pathname, search]);

  // Layout to URL.
  const workflowId = useOpenId(workflowEditorStore);
  const presetId = useOpenId(presetEditorStore);
  const characterId = useOpenId(characterEditorStore);
  const personaId = useOpenId(personaEditorStore);
  const providerId = useOpenId(providerEditorStore);
  const snippetId = useOpenId(snippetEditorStore);
  const stateDefinitionId = useOpenId(stateDefinitionEditorStore);
  const collectionId = useOpenId(collectionEditorStore);
  const openIds = {
    workflows: workflowId,
    presets: presetId,
    snippets: snippetId,
    providers: providerId,
    stateDefinitions: stateDefinitionId,
    characters: characterId,
    personas: personaId,
    collections: collectionId,
  };
  const next = formatLayoutUrl(layoutToUrl(layout, openIds, chat.session?.id));
  const loading = phoneEditorLoading(layout, openIds);
  useEffect(() => {
    if (applying.current || loading) return;
    const correction = forceReplace.current;
    forceReplace.current = false;
    if (next === synced.current) return;
    const replace = correction || sameContent(parseLayoutUrl(synced.current), parseLayoutUrl(next));
    synced.current = next;
    navigate({ pathname: '/', search: next }, { replace });
  }, [next, settled, loading]);
}
