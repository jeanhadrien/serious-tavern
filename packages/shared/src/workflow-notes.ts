import { noteSchema, type Note } from './models.js';

/**
 * The sticky notes a stored workflow carries. Stored records are not parsed on read, so `notes` may be missing or not a
 * list, and an item may not be a note: those read as none, and the rest is kept as stored.
 */
export function workflowNotes(workflow: { notes?: unknown }): Note[] {
  if (!Array.isArray(workflow.notes)) return [];
  return workflow.notes.flatMap((item) => {
    const parsed = noteSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
