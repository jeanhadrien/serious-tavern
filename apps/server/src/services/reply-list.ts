import {
  cardReads,
  mergeAccess,
  type Access,
  type Character,
  type Persona,
  type ReplyEntry,
  type Session,
  type StateDefinition,
  type ValidationIssue,
  type Workflow,
} from '@st/shared';
import { prepareWorkflow, type NodeResources, type PreparedWorkflow } from '@st/engine';
import type { AppContext } from '../context.js';
import { nodeResources } from './node-resources.js';

/** One enabled entry of a chat's reply list, looked up and prepared: the workflow, or why it cannot run. */
export type ListedWorkflow = {
  entry: ReplyEntry;
  /** Absent when the workflow no longer exists. */
  workflow?: Workflow;
  /** Absent when the workflow is invalid (`issues` says why) or gone. */
  prepared?: PreparedWorkflow;
  issues: ValidationIssue[];
};

/**
 * Looks up and prepares each entry, in list order, against one listing of the state definitions: the one a turn's runs and
 * the plan both resolve their ports and template references with, so they cannot disagree. Never throws for a workflow
 * that is missing or invalid: the caller decides what that means (a turn refuses to start, the plan says so).
 */
export async function prepareList(
  context: AppContext,
  entries: readonly ReplyEntry[],
  definitions: readonly StateDefinition[],
): Promise<ListedWorkflow[]> {
  const resources = {
    ...nodeResources(context),
    stateDefinitions: {
      get: async (id: string) => definitions.find((definition) => definition.id === id),
      list: async () => [...definitions],
    },
  };
  const listed: ListedWorkflow[] = [];
  for (const entry of entries) {
    const workflow = await context.workflows.get(entry.workflowId);
    if (!workflow) {
      listed.push({ entry, issues: [] });
      continue;
    }
    const { errors, prepared } = await prepareWorkflow(workflow, resources);
    listed.push({ entry, workflow, ...(prepared ? { prepared } : {}), issues: errors });
  }
  return listed;
}

/**
 * The characters a chat's runs can render: the session's character and persona (a Character node may name others).
 * `resources` is a prepared workflow's: a card the workflow's own Character node names is then loaded once and shared.
 */
export async function sessionCards(
  { characters, personas }: Pick<AppContext, 'characters' | 'personas'>,
  session: Pick<Session, 'characterId' | 'personaId'>,
  resources?: Pick<NodeResources, 'characters'>,
): Promise<{ character?: Character; persona?: Persona }> {
  const character = session.characterId
    ? await (resources?.characters ?? characters).get(session.characterId)
    : undefined;
  const persona = session.personaId ? await personas.get(session.personaId) : undefined;
  return { ...(character ? { character } : {}), ...(persona ? { persona } : {}) };
}

/**
 * What a run reads and writes: its workflow's (`PreparedWorkflow.access`) plus what the macros in the fields of the
 * session's character and persona read when they are rendered, which any template of the run may do.
 */
export function runAccess(
  prepared: Pick<PreparedWorkflow, 'access'>,
  cards: { character?: Character; persona?: Persona },
  definitions: readonly StateDefinition[],
): Access {
  return mergeAccess(prepared.access, {
    reads: [
      ...cardReads(cards.character, 'character', definitions),
      ...cardReads(cards.persona, 'persona', definitions),
    ],
    writes: [],
  });
}
