import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Chat } from '../pages/Chat.js';
import { ChatSidebar } from '../pages/chat/ChatSidebar.js';
import { useChat } from '../pages/chat/useChat.js';
import { IconButton } from '../components/IconButton.js';
import { ColumnHeader } from './ColumnHeader.js';
import { activeIcon, columnIcons, mobileView, VIEW_KEYS, viewSlots, type ViewKey } from './derive.js';
import { MiddleHeader } from './MiddleHeader.js';
import { MobileMenu } from './MobileMenu.js';
import { ResizeHandle } from './ResizeHandle.js';
import { DIRTY_SOURCES, STATIC_VIEWS } from './staticViews.js';
import { LayoutActionsProvider } from './LayoutActions.js';
import {
  DESIGN_KINDS,
  initialLayout,
  layoutReducer,
  type Column,
  type IconId,
  type MobileView,
  type ResourceId,
} from './state.js';
import { parseLayoutUrl, urlTarget } from './url.js';
import { useColumnWidths } from './useColumnWidths.js';
import { useCompactMode, useMobileMode } from './useCompactMode.js';
import { useDirtySync } from './useDirtySync.js';
import { searchOf, useLayoutUrl } from './useLayoutUrl.js';
import { VIEW_INFO } from './views.js';
import { HANDLE_WIDTH } from './widths.js';
import './shell.css';

const BODY_AREA: Record<Column, string> = { L: 'lb', M: 'mb', R: 'rb' };
// Phone mode shows one column at a time, in the single body area.
const MOBILE_BODY_AREA: Record<Column, string> = { L: 'mb', M: 'mb', R: 'mb' };

/** The three-column shell: top bar, L | M | R columns, and every view mounted exactly once. */
export function Shell() {
  const mobile = useMobileMode();
  const compact = useCompactMode() || mobile;
  const location = useLocation();
  // The first layout comes straight from the URL, so a reload shows it without a flash of the default.
  const [layout, dispatch] = useReducer(layoutReducer, { compact, mobile }, (viewport) =>
    layoutReducer(initialLayout(DESIGN_KINDS, viewport.compact, viewport.mobile), {
      type: 'restore',
      target: urlTarget(parseLayoutUrl(searchOf(location.pathname, location.search))),
    }),
  );
  useEffect(() => {
    // Phone mode first: leaving it must not briefly show the compact layout as if it were still a phone.
    dispatch({ type: 'setMobile', mobile });
    dispatch({ type: 'setCompact', compact });
  }, [mobile, compact]);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!mobile) setMenuOpen(false);
  }, [mobile]);

  useDirtySync(DIRTY_SOURCES, dispatch);
  const actions = useMemo(
    () => ({
      openEditor: (id: ResourceId) => dispatch({ type: 'openEditor', id }),
      closeEditor: (id: ResourceId) => dispatch({ type: 'closeEditor', id }),
      selectTab: (id: IconId) => dispatch({ type: 'selectTab', id }),
    }),
    [],
  );

  const gridRef = useRef<HTMLDivElement>(null);
  const { widths, resize } = useColumnWidths(gridRef, compact ? 2 : 3);
  const chat = useChat();
  useLayoutUrl(layout, dispatch, chat);

  const slots = viewSlots(layout);
  // On a phone, a chat opened from the list replaces the list on screen (no-op elsewhere).
  const showChat = () => dispatch({ type: 'showMiddle', chat: true });
  const views: Record<ViewKey, ReactNode> = {
    chat: <Chat chat={chat} />,
    'list:chats': (
      <ChatSidebar
        sessions={chat.sessions}
        activeId={chat.session?.id}
        canCreate={!!chat.workflows.length}
        disabled={chat.busy || chat.mutating}
        onOpen={(id) => {
          showChat();
          return chat.open(id);
        }}
        onCreate={() => {
          showChat();
          return chat.create();
        }}
        onDelete={chat.remove}
      />
    ),
    ...STATIC_VIEWS,
  };

  const select = actions.selectTab;
  const shown = mobileView(layout);
  const selectMobile = (view: MobileView) =>
    view === 'chat' || view === 'editor' ? dispatch({ type: 'showMiddle', chat: view === 'chat' }) : select(view);
  const anyDirty = Object.values(layout.dirty).some(Boolean);
  const titleId = shown === 'editor' ? layout.wide : shown;
  const mobileTitle = titleId && VIEW_INFO[titleId].label;
  const gridStyle: CSSProperties = mobile
    ? { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateAreas: '"mh" "mb"' }
    : {
        gridTemplateColumns: compact
          ? `${widths.left}px ${HANDLE_WIDTH}px minmax(0, 1fr)`
          : `${widths.left}px ${HANDLE_WIDTH}px minmax(0, 1fr) ${HANDLE_WIDTH}px ${widths.right}px`,
        gridTemplateAreas: compact ? '"lh lres mh" "lb lres mb"' : '"lh lres mh rres rh" "lb lres mb rres rb"',
      };
  const bodyArea = mobile ? MOBILE_BODY_AREA : BODY_AREA;
  return (
    <LayoutActionsProvider value={actions}>
      <div className="app">
        {!mobile && (
          <header className="top-bar">
            <strong>Serious Tavern</strong>
          </header>
        )}
        <div className="shell-grid" ref={gridRef} style={gridStyle} data-compact={compact} data-mobile={mobile}>
          {!mobile && (
            <ColumnHeader
              area="lh"
              label="Left column"
              icons={columnIcons(layout, 'L')}
              active={activeIcon(layout, 'L')}
              dirty={layout.dirty}
              onSelect={select}
            />
          )}
          <MiddleHeader
            editor={mobile && layout.pane === 'L' ? undefined : layout.wide}
            compact={compact}
            chatShown={slots.chat === 'M'}
            onClose={(id) => dispatch({ type: 'closeEditor', id })}
            onToggleChat={() => dispatch({ type: 'toggleCompactChat' })}
            menu={
              mobile && <IconButton icon={Menu} label="Open menu" dot={anyDirty} onClick={() => setMenuOpen(true)} />
            }
            title={mobile ? mobileTitle : undefined}
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
          {!mobile && (
            <ResizeHandle
              label="Resize left column"
              area="lres"
              value={widths.left}
              direction={1}
              onResize={(width) => resize('left', width)}
            />
          )}
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
                style={slot ? { gridArea: bodyArea[slot] } : undefined}
              >
                {views[key]}
              </section>
            );
          })}
        </div>
        {mobile && (
          <MobileMenu
            open={menuOpen}
            active={shown}
            wide={layout.wide}
            dirty={layout.dirty}
            onSelect={selectMobile}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>
    </LayoutActionsProvider>
  );
}
