import { useEffect, useRef } from 'react';
import { PencilLine, X, type LucideIcon } from 'lucide-react';
import { IconButton } from '../components/IconButton.js';
import type { MobileView } from './derive.js';
import type { IconId, ResourceId } from './state.js';
import { VIEW_INFO, WIDE_EDITOR_LABEL } from './views.js';

const SECTIONS: readonly { title: string; items: readonly IconId[] }[] = [
  { title: 'Content', items: ['chats', 'characters', 'personas'] },
  { title: 'Setup', items: ['workflows', 'presets', 'providers', 'settings'] },
];

interface MobileMenuProps {
  open: boolean;
  /** What the screen shows now. */
  active: MobileView;
  /** The open wide editor, offered next to the chat. */
  wide?: ResourceId;
  /** Resources whose editor has unsaved changes. */
  dirty: Record<ResourceId, boolean>;
  onSelect: (view: MobileView) => void;
  onClose: () => void;
}

/** Phone mode's navigation: a drawer listing the chat, the open wide editor and every list. */
export function MobileMenu({ open, active, wide, dirty, onSelect, onClose }: MobileMenuProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const item = (view: MobileView, Icon: LucideIcon, label: string, dot: boolean) => (
    <button
      key={view}
      type="button"
      className={`mobile-menu-item${view === active ? ' active' : ''}`}
      aria-current={view === active ? 'page' : undefined}
      onClick={() => {
        onSelect(view);
        onClose();
      }}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      {dot && <span className="icon-button-dot" aria-label="Unsaved changes" />}
    </button>
  );
  const listItem = (id: IconId) =>
    item(id, VIEW_INFO[id].icon, VIEW_INFO[id].label, id !== 'chat' && id !== 'chats' && dirty[id]);

  return (
    // The native dialog traps focus and closes on Escape; a click on its backdrop lands on the dialog itself.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click's keyboard twin is Escape, built into the dialog
    <dialog
      ref={dialog}
      className="mobile-menu"
      aria-label="Menu"
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <nav className="mobile-menu-panel">
        <div className="mobile-menu-title">
          <strong>Serious Tavern</strong>
          <IconButton icon={X} label="Close menu" onClick={onClose} />
        </div>
        {listItem('chat')}
        {wide && item('editor', PencilLine, WIDE_EDITOR_LABEL[wide] ?? VIEW_INFO[wide].label, dirty[wide])}
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            {section.items.map(listItem)}
          </section>
        ))}
      </nav>
    </dialog>
  );
}
