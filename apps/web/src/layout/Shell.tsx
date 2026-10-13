import { useEffect, useMemo, useReducer, useRef, type CSSProperties, type ReactNode } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { Chat } from '../pages/Chat.js';
import { ChatSidebar } from '../pages/chat/ChatSidebar.js';
import { useChat } from '../pages/chat/useChat.js';
import { Characters, Personas } from '../pages/Entities.js';
import { Presets } from '../pages/Presets.js';
import { Settings } from '../pages/Settings.js';
import { Workflows } from '../pages/Workflows.js';
import { PresetListView } from '../pages/presets/PresetListView.js';
import { WorkflowList } from '../pages/workflows/WorkflowList.js';
import { presetEditorStore, workflowEditorStore } from '../stores/index.js';
import { ColumnHeader } from './ColumnHeader.js';
import { activeIcon, columnIcons, VIEW_KEYS, viewSlots, type ViewKey } from './derive.js';
import { MiddleHeader } from './MiddleHeader.js';
import { ResizeHandle } from './ResizeHandle.js';
import { LayoutActionsProvider } from './LayoutActions.js';
import { isHostedWhole, isKnownPath, routeTarget } from './routes.js';
import { initialLayout, layoutReducer, type Column, type EditorKind, type IconId, type ResourceId } from './state.js';
import { useColumnWidths } from './useColumnWidths.js';
import { useCompactMode } from './useCompactMode.js';
import { useDirtySync } from './useDirtySync.js';
import { HANDLE_WIDTH } from './widths.js';
import './shell.css';

// Workflows and presets are split into a list (in L) and a wide editor (in M). Until the other
// resources are split too, their whole page is hosted as a wide editor in M. The layout model
// already handles narrow editors.
const INTERIM_KINDS: Record<ResourceId, EditorKind> = {
  workflows: 'wide',
  presets: 'wide',
  settings: 'wide',
  characters: 'wide',
  personas: 'wide',
};

const BODY_AREA: Record<Column, string> = { L: 'lb', M: 'mb', R: 'rb' };

function ListPlaceholder({ children }: { children: ReactNode }) {
  return <p className="hint list-placeholder">{children}</p>;
}

// Views that take no props are created once: the shell re-renders on every streamed chat token,
// and a stable element lets React skip re-rendering these pages (the workflow canvas above all).
const STATIC_VIEWS = {
  'list:workflows': <WorkflowList />,
  'list:presets': <PresetListView />,
  'list:settings': <ListPlaceholder>Settings open in the middle.</ListPlaceholder>,
  'list:characters': <ListPlaceholder>Character list coming soon. The editor opens in the middle.</ListPlaceholder>,
  'list:personas': <ListPlaceholder>Persona list coming soon. The editor opens in the middle.</ListPlaceholder>,
  'editor:workflows': <Workflows />,
  'editor:presets': <Presets />,
  'editor:settings': <Settings />,
  'editor:characters': <Characters />,
  'editor:personas': <Personas />,
} satisfies Partial<Record<ViewKey, ReactNode>>;

// Editors report their unsaved changes here; the shell shows them as a dot on the resource's icon.
const DIRTY_SOURCES = { workflows: workflowEditorStore, presets: presetEditorStore };

/** The three-column shell: top bar, L | M | R columns, and every view mounted exactly once. */
export function Shell() {
  const compact = useCompactMode();
  const [layout, dispatch] = useReducer(layoutReducer, compact, (isCompact) => initialLayout(INTERIM_KINDS, isCompact));
  useEffect(() => dispatch({ type: 'setCompact', compact }), [compact]);

  useDirtySync(DIRTY_SOURCES, dispatch);
  const actions = useMemo(() => ({ openEditor: (id: ResourceId) => dispatch({ type: 'openEditor', id }) }), []);

  // Existing URLs (e.g. /presets?id=…) show that resource's list and, when they name an item, its editor;
  // the editor reads the query itself.
  const location = useLocation();
  useEffect(() => {
    const target = routeTarget(location.pathname, location.search);
    if (target) {
      dispatch({ type: 'selectTab', id: target.resource });
      if (target.openEditor) dispatch({ type: 'openEditor', id: target.resource });
    }
  }, [location.key, location.pathname, location.search]);

  const gridRef = useRef<HTMLDivElement>(null);
  const { widths, resize } = useColumnWidths(gridRef, compact ? 2 : 3);
  const chat = useChat();

  const slots = viewSlots(layout);
  const views: Record<ViewKey, ReactNode> = {
    chat: <Chat chat={chat} />,
    'list:chats': (
      <ChatSidebar
        sessions={chat.sessions}
        activeId={chat.session?.id}
        canCreate={!!chat.workflows.length}
        disabled={chat.busy || chat.mutating}
        onOpen={chat.open}
        onCreate={chat.create}
        onDelete={chat.remove}
      />
    ),
    ...STATIC_VIEWS,
  };

  // Interim: a resource not yet split has no list to pick an item from, so its icon opens the page itself.
  const select = (id: IconId) => {
    dispatch({ type: 'selectTab', id });
    if (id !== 'chat' && id !== 'chats' && isHostedWhole(id)) dispatch({ type: 'openEditor', id });
  };
  const gridStyle: CSSProperties = {
    gridTemplateColumns: compact
      ? `${widths.left}px ${HANDLE_WIDTH}px minmax(0, 1fr)`
      : `${widths.left}px ${HANDLE_WIDTH}px minmax(0, 1fr) ${HANDLE_WIDTH}px ${widths.right}px`,
    gridTemplateAreas: compact ? '"lh lres mh" "lb lres mb"' : '"lh lres mh rres rh" "lb lres mb rres rb"',
  };
  return (
    <LayoutActionsProvider value={actions}>
      <div className="app">
        {!isKnownPath(location.pathname) && <Navigate to="/" replace />}
        <header className="top-bar">
          <strong>Serious Tavern</strong>
        </header>
        <div className="shell-grid" ref={gridRef} style={gridStyle} data-compact={compact}>
          <ColumnHeader
            area="lh"
            label="Left column"
            icons={columnIcons(layout, 'L')}
            active={activeIcon(layout, 'L')}
            dirty={layout.dirty}
            onSelect={select}
          />
          <MiddleHeader
            editor={layout.wide}
            compact={compact}
            chatShown={slots.chat === 'M'}
            onClose={(id) => dispatch({ type: 'closeEditor', id })}
            onToggleChat={() => dispatch({ type: 'toggleCompactChat' })}
          />
          {!compact && (
            <ColumnHeader
              area="rh"
              label="Right column"
              icons={columnIcons(layout, 'R')}
              active={activeIcon(layout, 'R')}
              dirty={layout.dirty}
              onSelect={select}
            />
          )}
          <ResizeHandle
            label="Resize left column"
            area="lres"
            value={widths.left}
            direction={1}
            onResize={(width) => resize('left', width)}
          />
          {!compact && (
            <ResizeHandle
              label="Resize right column"
              area="rres"
              value={widths.right}
              direction={-1}
              onResize={(width) => resize('right', width)}
            />
          )}
          {/* Views never change position in this list: moving one between columns only changes its grid
            area, so React keeps it mounted (streams, drafts, scroll and canvases survive). */}
          {VIEW_KEYS.map((key) => {
            const slot = slots[key];
            return (
              <section
                key={key}
                className="view"
                data-view={key}
                hidden={!slot}
                style={slot ? { gridArea: BODY_AREA[slot] } : undefined}
              >
                {views[key]}
              </section>
            );
          })}
        </div>
      </div>
    </LayoutActionsProvider>
  );
}
