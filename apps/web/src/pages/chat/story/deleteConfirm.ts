/**
 * The text of the `window.confirm` for a delete that undoes stored state. `note` (what the delete stops using of the
 * linked state) comes before the question, so the user reads everything first and is asked last.
 */
export function deleteConfirmText(lines: readonly string[], note?: string): string {
  const stored = `Deleting this reply also undoes what its turn stored:\n\n${lines.map((line) => `- ${line}`).join('\n')}`;
  return `${stored}\n\n${note ? `${note}\n\n` : ''}Delete the reply?`;
}

/**
 * What a click on the trash button does. A delete that undoes stored state (`undone` lists what) asks with a
 * dialog first (`confirm` shows it and answers whether to go on); any other delete takes the ordinary inline
 * "Delete message?" step (which shows `note` itself). `confirm` is only asked when there is something to list.
 */
export function deleteClick(
  undone: readonly string[] | undefined,
  confirm: (text: string) => boolean,
  note?: string,
): 'inline' | 'delete' | 'cancel' {
  if (!undone?.length) return 'inline';
  return confirm(deleteConfirmText(undone, note)) ? 'delete' : 'cancel';
}
