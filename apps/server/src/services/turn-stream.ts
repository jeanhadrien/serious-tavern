import { randomUUID } from 'node:crypto';
import type { ApiResponse, Character, ChatMessage, Session } from '@st/shared';
import type { EngineEvent, NodeDelta, PreparedWorkflow } from '@st/engine';
import type { Repository } from '../storage/repository.js';
import { now } from '../context.js';
import { passthroughSources, replyRanks } from './stream-bindings.js';

export type TurnFrame = ApiResponse<'streamTurn'>;

// Interim text is written at most every FLUSH_INTERVAL_MS. A crash can lose one window of tokens;
// that is accepted for alpha. Settling the turn always writes the full text, so no terminal path loses it.
const FLUSH_INTERVAL_MS = 250;

type Stamp = { name?: string; characterId?: string };

/** A streamed Chat Output's row, as the turn holds it in memory. */
export type StreamedRow = Stamp & {
  id: string;
  outputId: string;
  createdAt: string;
  content: string;
  reasoning: string;
};

type StreamState = {
  outputId: string;
  llmId: string;
  rank: number;
  id: string;
  createdAt: string;
  configName: string;
  // The Chat Output's `character` input edge, if any. Its name is stamped only once that node has settled.
  character?: { nodeId: string; handle: string };
  started: boolean;
  minted: boolean;
  dirty: boolean;
  content: string;
  reasoning: string;
  unsentText: string;
  unsentReasoning: string;
  // A step of a tool loop ended: the next frame tells the client to clear the text it holds first.
  resetPending: boolean;
  // The next reasoning starts a new step's: it is separated from what came before by a blank line.
  reasoningBreak: boolean;
};

/**
 * Turns engine events for passthrough outputs into real assistant rows (status `streaming`) and
 * `node.delta` frames for the output node. Everything runs on one serial chain: a row is persisted
 * before any frame refers to it, and frames leave in engine order.
 */
export class TurnStream {
  private readonly streams: StreamState[] = [];
  private readonly byLlm = new Map<string, StreamState[]>();
  private readonly settled = new Map<string, { output?: Record<string, unknown> }>();
  private chain: Promise<void> = Promise.resolve();
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly options: {
      sessions: Repository<Session>;
      sessionId: string;
      // The turn (the first run's execution id): the rows' `executionId`.
      executionId: string;
      // The run these rows and frames belong to: the rows' `runId`, and the `runId` of every node frame.
      runId: string;
      // A regenerate's rows are alternatives of the turn this root started (see alternatives.ts).
      alternativeOf?: string;
      prepared: PreparedWorkflow;
      emit: (frame: TurnFrame) => void;
    },
  ) {
    const { prepared } = options;
    const ranks = replyRanks(prepared);
    for (const [outputId, llmId] of passthroughSources(prepared)) {
      const output = prepared.workflow.nodes.find((node) => node.id === outputId)!;
      const edge = (prepared.incoming.get(outputId) ?? []).find((item) => item.targetHandle === 'character');
      const stream: StreamState = {
        outputId,
        llmId,
        rank: ranks.get(outputId) ?? 0,
        id: randomUUID(),
        createdAt: now(),
        configName: String(output.config.name ?? ''),
        ...(edge ? { character: { nodeId: edge.source, handle: edge.sourceHandle } } : {}),
        started: false,
        minted: false,
        dirty: false,
        content: '',
        reasoning: '',
        unsentText: '',
        unsentReasoning: '',
        resetPending: false,
        reasoningBreak: false,
      };
      this.streams.push(stream);
      this.byLlm.set(llmId, [...(this.byLlm.get(llmId) ?? []), stream]);
    }
  }

  // Observers never change the outcome; the engine already swallows exceptions from this callback.
  readonly onEvent = (event: EngineEvent): void => {
    const nodeId = event.nodeId ?? '';
    switch (event.type) {
      case 'node:start':
        this.enqueue(() => this.options.emit({ type: 'node.start', nodeId, runId: this.options.runId }));
        break;
      case 'node:complete':
        this.settled.set(nodeId, { output: event.detail as Record<string, unknown> });
        this.enqueue(() => this.options.emit({ type: 'node.complete', nodeId, runId: this.options.runId }));
        this.enqueue(() => this.pump(false));
        break;
      case 'node:skipped':
      case 'node:cancelled':
      case 'node:error':
        this.settled.set(nodeId, {});
        this.enqueue(() => this.pump(false));
        break;
      case 'node:delta':
        this.absorb(nodeId, event.detail as NodeDelta | undefined);
        break;
    }
  };

  /** Stops the flush timer, writes everything pending, and returns the streamed rows in their final state. */
  async finish(): Promise<StreamedRow[]> {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.enqueue(() => this.pump(true));
    this.enqueue(() => this.flushDirty());
    await this.chain;
    return this.streams.filter((stream) => stream.started).map((stream) => this.row(stream));
  }

  private absorb(llmId: string, detail: NodeDelta | undefined) {
    const targets = this.byLlm.get(llmId) ?? [];
    if (!targets.length) return;
    if (detail?.stepStart) {
      for (const stream of targets) this.startStep(stream);
    } else {
      const textDelta = detail?.textDelta ?? '';
      const reasoningDelta = detail?.reasoningDelta ?? '';
      if (!textDelta && !reasoningDelta) return;
      for (const stream of targets) {
        stream.started = true;
        stream.dirty = true;
        // The first reasoning of a later step is set apart from the earlier steps' reasoning.
        const reasoning = stream.reasoningBreak && reasoningDelta ? `\n\n${reasoningDelta}` : reasoningDelta;
        if (reasoningDelta) stream.reasoningBreak = false;
        stream.content += textDelta;
        stream.reasoning += reasoning;
        stream.unsentText += textDelta;
        stream.unsentReasoning += reasoning;
      }
    }
    this.enqueue(() => this.pump(false));
    this.scheduleFlush();
  }

  // A tool loop moved on to its next step. Only the last step's text is the answer, so the text so far is dropped
  // (stored rows then hold the last step's text only, a partial one included); reasoning is kept, step by step.
  private startStep(stream: StreamState) {
    if (stream.reasoning) stream.reasoningBreak = true;
    if (!stream.content) return;
    stream.content = '';
    stream.unsentText = '';
    stream.resetPending = true;
    stream.dirty = true;
  }

  private scheduleFlush() {
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined;
      this.enqueue(() => this.flushDirty());
    }, FLUSH_INTERVAL_MS);
  }

  // Mints rows whose name is known, then emits the deltas that accumulated for them. `force` mints
  // rows still waiting on a Character input, for turns that end before that node settles.
  private async pump(force: boolean): Promise<void> {
    for (const stream of this.streams) {
      if (!stream.started) continue;
      if (!stream.minted) {
        const stamp = this.stampOf(stream, force);
        if (!stamp) continue;
        await this.mint(stream, stamp);
      }
      if (!stream.unsentText && !stream.unsentReasoning && !stream.resetPending) continue;
      const frame = {
        type: 'node.delta' as const,
        nodeId: stream.outputId,
        runId: this.options.runId,
        ...(stream.resetPending ? { reset: true } : {}),
        ...(stream.unsentText ? { textDelta: stream.unsentText } : {}),
        ...(stream.unsentReasoning ? { reasoningDelta: stream.unsentReasoning } : {}),
      };
      stream.resetPending = false;
      stream.unsentText = '';
      stream.unsentReasoning = '';
      this.options.emit(frame);
    }
  }

  // Mirrors the executor: the Chat Output's name is the connected character's name, or its `name` config.
  private stampOf(stream: StreamState, force: boolean): Stamp | undefined {
    const source = stream.character;
    const settled = source ? this.settled.get(source.nodeId) : undefined;
    if (source && !settled && !force) return undefined;
    const character = source ? (settled?.output?.[source.handle] as Character | undefined) : undefined;
    const name = character?.name || stream.configName;
    return { ...(name ? { name } : {}), ...(character ? { characterId: character.id } : {}) };
  }

  // The reserved position is the slot before the first minted row that ranks later. The settled
  // turn rewrites the tail in the engine's order, so this only needs to be right while streaming.
  private async mint(stream: StreamState, stamp: Stamp): Promise<void> {
    const later = this.streams
      .filter((item) => item.minted && item.rank > stream.rank)
      .sort((a, b) => a.rank - b.rank)[0];
    await this.options.sessions.update(this.options.sessionId, (current) => {
      const row: ChatMessage = {
        id: stream.id,
        role: 'assistant',
        content: stream.content,
        status: 'streaming',
        nodeId: stream.outputId,
        sourceNodeId: stream.llmId,
        executionId: this.options.executionId,
        runId: this.options.runId,
        ...(this.options.alternativeOf ? { alternativeOf: this.options.alternativeOf } : {}),
        createdAt: stream.createdAt,
        ...stamp,
        ...(stream.reasoning ? { reasoning: stream.reasoning } : {}),
      };
      const index = later ? current.messages.findIndex((message) => message.id === later.id) : -1;
      if (index === -1) current.messages.push(row);
      else current.messages.splice(index, 0, row);
      return current;
    });
    stream.minted = true;
    stream.dirty = false;
  }

  // Full-text writes are idempotent, so a missed flush is repaired by the next one or by settling.
  // Writes never touch `updatedAt`; only sending a message advances it.
  private async flushDirty(): Promise<void> {
    const dirty = this.streams.filter((stream) => stream.minted && stream.dirty);
    if (!dirty.length) return;
    const snapshot = dirty.map((stream) => ({ id: stream.id, content: stream.content, reasoning: stream.reasoning }));
    for (const stream of dirty) stream.dirty = false;
    await this.options.sessions.update(this.options.sessionId, (current) => {
      for (const { id, content, reasoning } of snapshot) {
        const row = current.messages.find((message) => message.id === id);
        if (!row) continue;
        row.content = content;
        if (reasoning) row.reasoning = reasoning;
      }
      return current;
    });
  }

  private row(stream: StreamState): StreamedRow {
    return {
      id: stream.id,
      outputId: stream.outputId,
      createdAt: stream.createdAt,
      content: stream.content,
      reasoning: stream.reasoning,
      ...this.stampOf(stream, true),
    };
  }

  // A failed write is logged and dropped. Settling writes the full state again, so the turn still ends consistently.
  private enqueue(task: () => void | Promise<void>): void {
    this.chain = this.chain.then(task).catch((error: unknown) => {
      console.warn(`Streaming write failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
