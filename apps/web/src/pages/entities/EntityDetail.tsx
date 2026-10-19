import type { ReactNode } from 'react';
import { EditorHeader } from '../../components/EditorHeader.js';

export function EntityDetail({
  title,
  backLabel,
  dirty,
  onBack,
  onDelete,
  onSave,
  onRevert,
  actions,
  children,
}: {
  title: string;
  /** Names where the back arrow goes, e.g. "Back to characters". */
  backLabel: string;
  dirty: boolean;
  onBack: () => void;
  onDelete: () => Promise<void>;
  onSave: () => Promise<unknown>;
  onRevert: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="entity-editor">
      <EditorHeader
        title={title}
        back={{ label: backLabel, onClick: onBack }}
        dirty={dirty}
        extra={actions}
        actions={{
          save: { onClick: () => void onSave(), disabled: !dirty },
          revert: { onClick: onRevert },
          remove: { onClick: () => void onDelete() },
        }}
      />
      {children}
    </section>
  );
}
