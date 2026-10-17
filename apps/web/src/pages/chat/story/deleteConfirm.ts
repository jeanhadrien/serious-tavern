/** The text of the `window.confirm` for a delete that undoes stored state. */
export function deleteConfirmText(lines: readonly string[]): string {
  return `Deleting this reply also undoes what its turn stored:\n\n${lines.map((line) => `- ${line}`).join('\n')}\n\nDelete the reply?`;
}

/**
 * What a click on the trash button does. A delete that undoes stored state (`undone` lists what) asks with a
 * dialog first (`confirm` shows it and answers whether to go on); any other delete takes the ordinary inline
 * "Delete message?" step. `confirm` is only asked when there is something to list.
 */
export function deleteClick(
  undone: readonly string[] | undefined,
  confirm: (text: string) => boolean,
): 'inline' | 'delete' | 'cancel' {
  if (!undone?.length) return 'inline';
  return confirm(deleteConfirmText(undone)) ? 'delete' : 'cancel';
}
