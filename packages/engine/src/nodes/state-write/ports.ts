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

/** The `value` input an operation takes; none for `delete`. */
function valueInput(def: StateKeyDef, op: StateNodeOp): PortDef[] {
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
          description: 'How much to add; 1 when not connected. Negative numbers subtract.',
        },
      ];
    case 'add':
      return [
        {
          name: 'value',
          label: 'Item',
          dataType: 'any',
          required: true,
          description: 'Text, or an object with a text field and the declared fields of the key',
        },
      ];
    case 'remove':
      return [
        {
          name: 'value',
          label: 'Item id',
          dataType: 'text',
          required: true,
          description: 'The id of the item to remove, e.g. from an item this key holds',
        },
      ];
    default:
      return [
        {
          name: 'value',
          label: 'Value',
          dataType: stateKeyPortType(def.type),
          required: true,
          description: 'The value to store',
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

/** Ports of a State Write node for a key and operation. */
export function writePorts(def: StateKeyDef, op: StateNodeOp): { inputs: PortDef[]; outputs: PortDef[] } {
  return {
    inputs: valueInput(def, op),
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
