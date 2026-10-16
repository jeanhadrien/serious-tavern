import {
  stateKeyPortType,
  stateOpsFor,
  type PortDataType,
  type PortDef,
  type StateKeyDef,
  type StateNodeOp,
} from '@st/shared';

/** Throws a plain error when the key's type has no such operation. */
export function checkOp(def: StateKeyDef, op: string): StateNodeOp {
  const allowed = stateOpsFor(def.type);
  if (allowed.includes(op as StateNodeOp)) return op as StateNodeOp;
  const list = allowed.length > 1 ? `${allowed.slice(0, -1).join(', ')} or ${allowed.at(-1)}` : allowed[0];
  const article = /^[aeiou]/.test(def.type) ? 'an' : 'a';
  throw new Error(`Operation "${op}" can't be used on ${article} ${def.type} key; use ${list}`);
}

// Every operation takes this optional gate, so a branch can decide whether any write runs: `requiredIfConnected`
// skips the node when the connected branch isn't taken. Its value is ignored; unconnected, the node runs every turn.
const gate: PortDef = {
  name: 'when',
  label: 'Run when',
  dataType: 'any',
  requiredIfConnected: true,
  description:
    'Optional. Connect a branch (for example a Condition output) and the write only runs when that branch does. Not connected, it runs every turn.',
};

/**
 * The node's fixed `value` setting, or undefined when it has none. It stands in for the `value` input while that
 * is not connected (a connected input wins). A cleared (null) setting counts as none; any other value, an
 * empty text included, is a value, and is checked like one from the input.
 */
export function fixedValue(config: Record<string, unknown>): unknown {
  return config.value ?? undefined;
}

/**
 * The `value` input an operation takes; none for `delete`. With a fixed value the input is optional, since
 * the node has something to store without it; without one it must be connected.
 */
function valueInput(def: StateKeyDef, op: StateNodeOp, fixed: boolean): PortDef[] {
  const needed = fixed ? { requiredIfConnected: true } : { required: true };
  const instead = fixed ? " A connected value is used instead of the node's fixed value." : '';
  switch (op) {
    case 'delete':
      return [];
    case 'increment':
      return [
        {
          name: 'value',
          label: 'Amount',
          dataType: 'number',
          requiredIfConnected: true,
          description: "How much to add; negative numbers subtract. Not connected: the node's fixed value, else 1.",
        },
      ];
    case 'add':
      return [
        {
          name: 'value',
          label: 'Item',
          dataType: 'any',
          ...needed,
          description: `Text, or an object with a text field and the declared fields of the key.${instead}`,
        },
      ];
    case 'remove':
      return [
        {
          name: 'value',
          label: 'Item id',
          dataType: 'text',
          ...needed,
          description: `The id of the item to remove, e.g. from an item this key holds.${instead}`,
        },
      ];
    default:
      return [
        {
          name: 'value',
          label: 'Value',
          dataType: stateKeyPortType(def.type),
          ...needed,
          description: `The value to store.${instead}`,
        },
      ];
  }
}

const outputType = (def: StateKeyDef, op: StateNodeOp): PortDataType =>
  def.type === 'collection' && (op === 'add' || op === 'remove') ? 'object' : stateKeyPortType(def.type);

const OUTPUT_DESCRIPTION: Record<StateNodeOp, string> = {
  set: 'The value that was stored (numbers are clamped to the key bounds)',
  increment: "The new value, from this turn's start value plus this node's amount",
  add: 'The stored item, with its id',
  remove: 'The removed item; absent when no item has that id',
  delete: 'The default the key goes back to',
};

/** Ports of a State Write node for a key and operation; `fixed` says the node has a fixed value setting. */
export function writePorts(
  def: StateKeyDef,
  op: StateNodeOp,
  fixed = false,
): { inputs: PortDef[]; outputs: PortDef[] } {
  return {
    inputs: [...valueInput(def, op, fixed), gate],
    outputs: [
      {
        name: 'value',
        label: 'Value',
        dataType: outputType(def, op),
        optional: op === 'remove',
        description: OUTPUT_DESCRIPTION[op],
      },
    ],
  };
}
