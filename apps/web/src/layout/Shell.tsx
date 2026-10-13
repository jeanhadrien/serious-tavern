import { useEffect, useMemo, useReducer, useRef, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Chat } from '../pages/Chat.js';
import { ChatSidebar } from '../pages/chat/ChatSidebar.js';
import { useChat } from '../pages/chat/useChat.js';
import { CharacterList, Characters, PersonaList, Personas } from '../pages/Entities.js';
import { Presets } from '../pages/Presets.js';
import { Settings } from '../pages/Settings.js';
import { Workflows } from '../pages/Workflows.js';
import { PresetListView } from '../pages/presets/PresetListView.js';
import { WorkflowList } from '../pages/workflows/WorkflowList.js';
import { characterEditorStore, personaEditorStore, presetEditorStore, workflowEditorStore } from '../stores/index.js';
import { ColumnHeader } from './ColumnHeader.js';
import { activeIcon, columnIcons, VIEW_KEYS, viewSlots, type ViewKey } from './derive.js';
import { MiddleHeader } from './MiddleHeader.js';
import { ResizeHandle } from './ResizeHandle.js';
import { LayoutActionsProvider } from './LayoutActions.js';
import { DESIGN_KINDS, initialLayout, layoutReducer, type Column, type IconId, type ResourceId } from './state.js';
import { parseLayoutUrl, urlTarget } from './url.js';
import { useColumnWidths } from './useColumnWidths.js';
import { useCompactMode } from './useCompactMode.js';
import { useDirtySync } from './useDirtySync.js';
import { searchOf, useLayoutUrl } from './useLayoutUrl.js';
import { HANDLE_WIDTH } from './widths.js';
import './shell.css';

const BODY_AREA: Record<Column, string> = { L: 'lb', M: 'mb', R: 'rb' };

// Views that take no props are created once: the shell re-renders on every streamed chat token,
// and a stable element lets React skip re-rendering these pages (the workflow canvas above all).
const STATIC_VIEWS = {
  'list:workflows': <WorkflowList />,
  'list:presets': <PresetListView />,
  'list:characters': <CharacterList />,
  'list:personas': <PersonaList />,
  'editor:workflows': <Workflows />,
  'editor:presets': <Presets />,
  'editor:settings': <Settings />,
  'editor:characters': <Characters />,
  'editor:personas': <Personas />,
} satisfies Partial<Record<ViewKey, ReactNode>>;

// Editors report their unsaved changes here; the shell shows them as a dot on the resource's icon.
const DIRTY_SOURCES = {
  workflows: workflowEditorStore,
  presets: presetEditorStore,
  characters: characterEditorStore,
  personas: personaEditorStore,
};

/** The three-column shell: top bar, L | M | R columns, and every view mounted exactly once. */
export function Shell() {
  const compact = useCompactMode();
  const location = useLocation();
  // The first layout comes straight from the URL, so a reload shows it without a flash of the default.
  const [layout, dispatch] = useReducer(layoutReducer, compact, (isCompact) =>
    layoutReducer(initialLayout(DESIGN_KINDS, isCompact), {
      type: 'restore',
      target: urlTarget(parseLayoutUrl(searchOf(location.pathname, location.search))),
    }),
  );
  useEffect(() => dispatch({ type: 'setCompact', compact }), [compact]);

  useDirtySync(DIRTY_SOURCES, dispatch);
  const actions = useMemo(
    () => ({
      openEditor: (id: ResourceId) => dispatch({ type: 'openEditor', id }),
      closeEditor: (id: ResourceId) => dispatch({ type: 'closeEditor', id }),
    }),
    [],
  );

  const gridRef = useRef<HTMLDivElement>(null);
  const { widths, resize } = useColumnWidths(gridRef, compact ? 2 : 3);
  const chat = useChat();
  useLayoutUrl(layout, dispatch, chat);

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

  const select = (id: IconId) => dispatch({ type: 'selectTab', id });
  const gridStyle: CSSProperties = {
    gridTemplateColumns: compact
      ? `${widths.left}px ${HANDLE_WIDTH}px minmax(0, 1fr)`
      : `${widths.left}px ${HANDLE_WIDTH}px minmax(0, 1fr) ${HANDLE_WIDTH}px ${widths.right}px`,
    gridTemplateAreas: compact ? '"lh lres mh" "lb lres mb"' : '"lh lres mh rres rh" "lb lres mb rres rb"',
  };
  return (
    <LayoutActionsProvider value={actions}>
      <div className="app">
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
