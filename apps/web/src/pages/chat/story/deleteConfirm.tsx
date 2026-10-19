import { dialogs } from '../../../components/dialog/dialogStore.js';

/**
 * The body of the dialog for a delete that undoes stored state: what is undone, then `note` (what the delete stops
 * using of the linked state).
 */
export function UndoneByDelete({ lines, note }: { lines: readonly string[]; note?: string }) {
  return (
    <>
      <p>Deleting this reply also undoes what its turn stored:</p>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {note && <p>{note}</p>}
    </>
  );
}

const confirmUndoingDelete = async (lines: readonly string[], note?: string) =>
  (await dialogs.ask({
    title: 'Delete the reply?',
    body: <UndoneByDelete lines={lines} note={note} />,
    actions: [{ id: 'delete', label: 'Delete reply', kind: 'danger' }],
  })) === 'delete';

/**
 * What a click on the trash button does. A delete that undoes stored state (`undone` lists what) asks with a
 * dialog first (`confirm` shows it and answers whether to go on); any other delete takes the ordinary inline
 * "Delete message?" step (which shows `note` itself). `confirm` is only asked when there is something to list.
 */
export async function deleteClick(
  undone: readonly string[] | undefined,
  note?: string,
  confirm: (lines: readonly string[], note?: string) => Promise<boolean> = confirmUndoingDelete,
): Promise<'inline' | 'delete' | 'cancel'> {
  if (!undone?.length) return 'inline';
  return (await confirm(undone, note)) ? 'delete' : 'cancel';
}
