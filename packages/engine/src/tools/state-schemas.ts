import { keyDefault, stateOpsFor, type StateKeyDef, type StateNodeOp } from '@st/shared';
import type { LocatedKey } from '../nodes/state-key.js';

/** A key a model can be given: every type but a thread (an exchange is not something a model reads or writes by hand). */
export type ToolKey = LocatedKey & { def: Exclude<StateKeyDef, { type: 'thread' }> };

// Edits only the tools offer: the tool works out the whole new text, which State Write then stores with `set`.
const TEXT_EDITS = ['replace', 'append'];

/**
 * The operations a write tool offers for a key type: State Write's, with `delete` called `reset` for the model, plus
 * the tool-only ones: the text edits, and a collection item's `update` (planned by `planUpdate`).
 */
export const writeOps = (def: StateKeyDef): string[] => [
  ...stateOpsFor(def.type).map((op) => (op === 'delete' ? 'reset' : op)),
  ...(def.type === 'text' ? TEXT_EDITS : def.type === 'collection' ? ['update'] : []),
];

/** Whether a tool's `op` word is a text edit, which the tool turns into a whole new text. */
export const isTextEdit = (op: string): op is 'replace' | 'append' => TEXT_EDITS.includes(op);

/** The State Write operation behind a tool's `op` word. */
export const stateOpOf = (op: string): StateNodeOp =>
  op === 'reset' ? 'delete' : isTextEdit(op) ? 'set' : (op as StateNodeOp);

/** What a key holds, in words: type, bounds, options and default. */
function typeText(def: ToolKey['def']): string {
  switch (def.type) {
    case 'number': {
      const bounds =
        def.min !== undefined && def.max !== undefined
          ? `from ${def.min} to ${def.max}`
          : def.min !== undefined
            ? `at least ${def.min}`
            : def.max !== undefined
              ? `at most ${def.max}`
              : '';
      return `a number${bounds && ` ${bounds}`} (values outside are clamped; default ${JSON.stringify(keyDefault(def))})`;
    }
    case 'boolean':
      return `true or false (default ${JSON.stringify(keyDefault(def))})`;
    case 'enum':
      return `one of ${def.options.map((option) => JSON.stringify(option)).join(', ')} (default ${JSON.stringify(keyDefault(def))})`;
    case 'text':
      return 'text';
    case 'object':
      return 'an object';
    case 'collection': {
      const fields = Object.entries(def.fields ?? {}).map(([name, type]) => `${name} (${type})`);
      return `a list of items with text${fields.length ? ` and the fields ${fields.join(', ')}` : ''}`;
    }
  }
}

/** One key for a tool description: its name, what it holds, and what the definition and the key say about it. */
export function keySummary({ label, definition, def }: ToolKey): string {
  return [`${label}: ${typeText(def)}.`, definition.description, def.description].filter(Boolean).join(' ');
}

const RESET = 'reset puts the key back to its default.';

/** The JSON Schema of a write tool's arguments, flat on purpose: backends handle it better than `oneOf`. */
export function writeParameters({ def }: ToolKey): Record<string, unknown> {
  const op = (description: string) => ({ type: 'string', enum: writeOps(def), description });
  switch (def.type) {
    case 'number':
      return {
        type: 'object',
        properties: {
          op: op(`set stores value, increment adds value (a negative one subtracts). ${RESET}`),
          value: { type: 'number', description: 'The number to store or to add. Not needed for reset.' },
        },
        required: ['op'],
      };
    case 'collection': {
      // `op`, `handle` and `text` belong to the tool; a declared field of the same name cannot be told apart from them.
      const fields = Object.entries(def.fields ?? {}).filter(([name]) => !['op', 'handle', 'text'].includes(name));
      return {
        type: 'object',
        properties: {
          op: op(
            `add stores a new item, update gives an item new text by its handle (its fields stay), remove deletes one by its handle. reset empties the list.`,
          ),
          text: { type: 'string', description: 'The text of the item to add, or the new text of the item to update.' },
          handle: {
            type: 'string',
            description: 'The handle of the item to update or remove (like #1), as read_state shows it.',
          },
          ...Object.fromEntries(
            fields.map(([name, type]) => [name, { type, description: `Field of the item to add.` }]),
          ),
        },
        required: ['op'],
      };
    }
    case 'text':
      return {
        type: 'object',
        properties: {
          op: op(
            `set (the default) stores value as the whole text. replace changes old, which must appear exactly once in the text, into value. append adds value at the end, on a new line. ${RESET}`,
          ),
          value: {
            type: 'string',
            description: 'The text to store, the replacement for old, or the text to append. Not needed for reset.',
          },
          old: { type: 'string', description: 'For replace: the exact text to change, as it appears in the key.' },
        },
      };
    default: {
      const value = {
        boolean: { type: 'boolean' },
        enum: { type: 'string', enum: def.type === 'enum' ? def.options : [] },
        object: { type: 'object' },
      }[def.type];
      return {
        type: 'object',
        properties: {
          op: op(`set (the default) stores value. ${RESET}`),
          value: { ...value, description: 'The value to store. Not needed for reset.' },
        },
      };
    }
  }
}
