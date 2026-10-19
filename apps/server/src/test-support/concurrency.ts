import { z } from 'zod';
import { registry } from '@st/engine';
import { noAccess } from '@st/shared';
import { edge, makeWorkflow, node, type App } from './story.js';

// Helpers of the tests of workflows that run at the same time: a node that holds each run until the test lets it go, so
// the order in which runs start, end and settle is the test's, never a matter of timing.

const HOLD_TYPE = 'hold-test';

type Waiter = { count: number; resolve: () => void };

/**
 * A normal node (`value` in, `value` out) that holds whatever run executes it, by `label` (its config), until
 * `release(label)` or `fail(label, message)`; it ends at once when the run is aborted. Registers itself in the engine
 * registry: call `dispose` in `afterEach`.
 */
export function holdNodes() {
  const begun: string[] = [];
  const waiters: Waiter[] = [];
  const gates = new Map<string, { settle: (error?: Error) => void; done: Promise<void> }>();
  const gate = (label: string) => {
    let existing = gates.get(label);
    if (!existing) {
      let settle!: (error?: Error) => void;
      const done = new Promise<void>((resolve, reject) => {
        settle = (error) => (error ? reject(error) : resolve());
      });
      done.catch(() => undefined);
      existing = { settle, done };
      gates.set(label, existing);
    }
    return existing;
  };
  registry.set(HOLD_TYPE, {
    type: HOLD_TYPE,
    label: 'Hold',
    description: '',
    category: 'Tests',
    inputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    outputs: [{ name: 'value', label: 'Value', dataType: 'any' }],
    configSchema: z.object({ label: z.string() }),
    defaultConfig: { label: '' },
    access: () => noAccess(),
    async execute(ctx) {
      const label = String(ctx.config.label);
      begun.push(label);
      for (const waiter of waiters) if (begun.length >= waiter.count) waiter.resolve();
      const aborted = new Promise<never>((_resolve, reject) => {
        if (ctx.signal.aborted) reject(ctx.signal.reason);
        ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
      });
      await Promise.race([gate(label).done, aborted]);
      return { value: ctx.inputs.value ?? label };
    },
  });
  return {
    /** The labels of the runs that began, in the order they began. */
    get begun() {
      return [...begun];
    },
    /** Resolves once `count` runs have begun holding (at once when they already have). */
    started: (count: number) =>
      begun.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push({ count, resolve });
          }),
    release: (label: string) => gate(label).settle(),
    fail: (label: string, message: string) => gate(label).settle(new Error(message)),
    dispose: () => {
      for (const { settle } of gates.values()) settle();
      registry.delete(HOLD_TYPE);
    },
  };
}

/** input -> hold(`label`) -> Chat Output with `template`; `extra` nodes and edges are added as they are given. */
export const holdingReply = (app: App, name: string, label: string, template: string) =>
  makeWorkflow(
    app,
    [node('input', 'chat-input'), node('hold', HOLD_TYPE, { label }), node('output', 'chat-output', { template })],
    [edge('input', 'message', 'hold', 'value'), edge('hold', 'value', 'output', 'value')],
    name,
  );

/**
 * input -> hold(`label`) -> a State Write of `key` (`op`, `value` when it needs a fixed one) that runs once the hold
 * is released. With `reply` the workflow also says that text (a Chat Output on the input, which does not wait for the
 * hold), so it belongs to the reply section; without it the workflow only writes, which puts it in the after section.
 */
export const holdingWriter = (
  app: App,
  name: string,
  label: string,
  write: { definitionId: string; key: string; op: string; value?: unknown },
  reply?: string,
) =>
  makeWorkflow(
    app,
    [
      node('input', 'chat-input'),
      node('hold', HOLD_TYPE, { label }),
      node('write', 'state-write', {
        definitionId: write.definitionId,
        key: write.key,
        op: write.op,
        ...(write.value === undefined ? {} : { value: write.value }),
      }),
      ...(reply === undefined ? [] : [node('output', 'chat-output', { template: reply })]),
    ],
    [
      edge('input', 'message', 'hold', 'value'),
      edge('hold', 'value', 'write', 'when'),
      ...(reply === undefined ? [] : [edge('input', 'message', 'output', 'value')]),
    ],
    name,
  );
