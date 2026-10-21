import { z } from 'zod';
import { usableSettings, workflowSettings, type WorkflowSetting } from './chat-settings.js';

/**
 * Triggers (docs/dev/explorations/TRIGGERS-PROPOSAL-1.md): what starts workflows in a chat. Only the reply trigger exists:
 * an ordered, toggleable list of workflows that run, one after another, on each reply. This file must not import
 * `models.ts` (the session schema imports it).
 */

/** One row of the reply list. Passthrough: later steps add fields. */
export const replyEntrySchema = z.object({ workflowId: z.string().min(1), enabled: z.boolean() }).passthrough();
export type ReplyEntry = z.infer<typeof replyEntrySchema>;

/** `session.triggers`. Optional on a session: older chats have none (see `replyWorkflows`). */
export const sessionTriggersSchema = z.object({ reply: z.array(replyEntrySchema) }).passthrough();
export type SessionTriggers = z.infer<typeof sessionTriggersSchema>;

/**
 * The chat's reply list, in order: the only reader of it. The stored list when it is an array with at least one entry
 * that parses (an entry that doesn't is skipped; a repeated `workflowId` keeps its first entry), otherwise the chat's
 * `workflowId` alone, enabled: the legacy shape, which every older chat has. Stored sessions are not parsed on read,
 * so `triggers` is whatever the file holds. New code never reads `session.workflowId` to decide what runs.
 */
export function replyWorkflows(session: { workflowId: string; triggers?: unknown }): ReplyEntry[] {
  const raw = (session.triggers as { reply?: unknown } | null | undefined)?.reply;
  const seen = new Set<string>();
  const entries = (Array.isArray(raw) ? raw : []).flatMap((item): ReplyEntry[] => {
    const parsed = replyEntrySchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.workflowId)) return [];
    seen.add(parsed.data.workflowId);
    return [parsed.data];
  });
  return entries.length ? entries : [{ workflowId: session.workflowId, enabled: true }];
}

/**
 * The chat settings a list of workflows declares together, in list order: a key several of them declare is one setting
 * (the first declaration wins, as `usableSettings` says everywhere). What PATCH checks values against and what the chat
 * panel and the preset preview show; a run resolves against its own workflow's declarations only.
 */
export function listedSettings(workflows: readonly { settings?: readonly unknown[] }[]): WorkflowSetting[] {
  return usableSettings(workflows.flatMap(workflowSettings));
}
