import { replyWorkflows, type ReplyEntry, type ReplyPlan, type Session, type Workflow } from '@st/shared';
import { moveItem } from '../../../components/sortable/moveItem.js';

// The chat panel's "On reply" list as pure functions: what each control changes, and what a row shows. The list itself
// is `session.triggers.reply`, read only through `replyWorkflows`; the server's rules (at least one entry, no repeated
// workflow) are kept here too, so a change that the server would refuse is never offered.

/** One row of the list: the entry, the workflow's name while it exists, and whether Remove is offered. */
export type ReplyRow = ReplyEntry & { name?: string; removable: boolean };

const unknownWorkflowLabel = (workflowId: string) => `Unknown workflow (${workflowId})`;
export const rowLabel = (row: Pick<ReplyRow, 'workflowId' | 'name'>) =>
  row.name ?? unknownWorkflowLabel(row.workflowId);

export function replyRows(list: readonly ReplyEntry[], workflows: readonly Workflow[]): ReplyRow[] {
  const names = new Map(workflows.map((workflow) => [workflow.id, workflow.name]));
  return list.map((entry) => ({ ...entry, ...withName(names.get(entry.workflowId)), removable: list.length > 1 }));
}
const withName = (name: string | undefined) => (name === undefined ? {} : { name });

/** The workflows of the list that exist, in list order: what the Settings section declares its controls from. */
export function listedWorkflows(list: readonly ReplyEntry[], workflows: readonly Workflow[]): Workflow[] {
  return list.flatMap((entry) => workflows.filter((workflow) => workflow.id === entry.workflowId));
}

/** The workflows the "Add workflow" picker offers: those not in the list yet (no duplicates), by name. */
export function addableWorkflows(list: readonly ReplyEntry[], workflows: readonly Workflow[]): Workflow[] {
  const listed = new Set(list.map((entry) => entry.workflowId));
  return workflows.filter((workflow) => !listed.has(workflow.id)).sort((a, b) => a.name.localeCompare(b.name));
}

export const addEntry = (list: readonly ReplyEntry[], workflowId: string): ReplyEntry[] =>
  list.some((entry) => entry.workflowId === workflowId) ? [...list] : [...list, { workflowId, enabled: true }];

/** Never removes the last entry: a chat always lists at least one workflow. */
export const removeEntry = (list: readonly ReplyEntry[], workflowId: string): ReplyEntry[] =>
  list.length > 1 ? list.filter((entry) => entry.workflowId !== workflowId) : [...list];

export const toggleEntry = (list: readonly ReplyEntry[], workflowId: string): ReplyEntry[] =>
  list.map((entry) => (entry.workflowId === workflowId ? { ...entry, enabled: !entry.enabled } : entry));

export const moveEntry = moveItem<ReplyEntry>;

/** Whether a reply would run anything: with every entry off, a send is refused (`NO_ENABLED_WORKFLOW`). */
export const anyEnabled = (list: readonly ReplyEntry[]) => list.some((entry) => entry.enabled);

/**
 * The reply list a NEW chat starts with: a copy of the open chat's (order and switches included), leaving out
 * workflows that no longer exist (the server answers `404` for them). Undefined when there is nothing to copy: no chat is
 * open, or none of its workflows exists any more; the caller then falls back to the Default Assistant alone.
 */
export function copiedList(
  session: Pick<Session, 'workflowId' | 'triggers'> | undefined,
  workflows: readonly Workflow[],
): ReplyEntry[] | undefined {
  if (!session) return undefined;
  const known = new Set(workflows.map((workflow) => workflow.id));
  const list = replyWorkflows(session)
    .filter((entry) => known.has(entry.workflowId))
    .map(({ workflowId, enabled }) => ({ workflowId, enabled }));
  return list.length ? list : undefined;
}

/** What a row says about when it runs: the text under its name, the server's reason as its title, and whether it is a problem. */
export type PlanHint = { text: string; title?: string; problem?: boolean };

/**
 * The hints of the "On reply" rows, from the server's plan (`GET /api/sessions/:id/reply-plan`; the web never works out
 * what waits for what). A disabled row has none, and neither has the first enabled row, which has nothing above it. A
 * workflow that waits says "Waits for X, Y" (the reason is the title); one that doesn't says it "Runs alongside the ones
 * above"; one that cannot run (gone or invalid) says why. Without a plan there are no hints.
 */
export function planHints(
  list: readonly ReplyEntry[],
  workflows: readonly Workflow[],
  plan: ReplyPlan | undefined,
): Map<string, PlanHint> {
  const hints = new Map<string, PlanHint>();
  if (!plan) return hints;
  const names = new Map(workflows.map((workflow) => [workflow.id, workflow.name]));
  const planned = new Map(plan.entries.map((entry) => [entry.workflowId, entry]));
  let above = 0;
  for (const { workflowId, enabled } of list) {
    const entry = enabled ? planned.get(workflowId) : undefined;
    if (!entry) continue;
    if (!entry.waitsFor.length && entry.reason) hints.set(workflowId, { text: entry.reason, problem: true });
    else if (entry.waitsFor.length) {
      const waits = entry.waitsFor.map((id) => rowLabel({ workflowId: id, name: names.get(id) })).join(', ');
      hints.set(workflowId, { text: `Waits for ${waits}`, ...(entry.reason ? { title: entry.reason } : {}) });
    } else if (above > 0) hints.set(workflowId, { text: 'Runs alongside the ones above' });
    above++;
  }
  return hints;
}
