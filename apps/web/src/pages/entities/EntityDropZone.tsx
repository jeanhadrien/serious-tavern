import { useState, type ReactNode } from 'react';

/** A column body that imports files dropped on it and shows an overlay while dragging. */
export function EntityDropZone({
  dropLabel,
  importFiles,
  children,
}: {
  dropLabel: string;
  importFiles: (files: File[]) => Promise<void>;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className="entity-dropzone"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void importFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {dragging ? (
        <div className="drop-overlay" aria-hidden="true">
          <strong>{dropLabel}</strong>
        </div>
      ) : null}
      {children}
    </div>
  );
}
