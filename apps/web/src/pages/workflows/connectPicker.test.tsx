import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NodeTypeDescriptor } from '@st/shared';
import { ConnectPicker } from './ConnectPicker.js';
import type { PickerState } from './useConnectPicker.js';

const descriptor = (type: string, label: string): NodeTypeDescriptor => ({
  type,
  label,
  description: '',
  category: 'Chat',
  dynamicPorts: false,
  inputs: [],
  outputs: [],
  configSchema: {},
  defaultConfig: {},
});
const picker = (candidates: PickerState['candidates']): PickerState => ({
  at: { x: 900, y: 10 },
  bounds: { width: 500, height: 400 },
  flow: { x: 0, y: 0 },
  from: { side: 'source', port: { name: 'text', label: 'Text', dataType: 'text' }, nodeId: 'n', handle: 'text' },
  candidates,
});
const render = (state: PickerState) =>
  renderToStaticMarkup(<ConnectPicker picker={state} onPick={() => {}} onClose={() => {}} />);

it('lists the candidates as options with their port, marks coercion and keeps the picker inside the canvas', () => {
  const html = render(
    picker([
      {
        descriptor: descriptor('chat-output', 'Chat Output'),
        port: { name: 'value', label: 'Value', dataType: 'text' },
        coerce: false,
      },
      { descriptor: descriptor('counter', 'Counter'), port: { name: 'n', label: 'N', dataType: 'text' }, coerce: true },
    ]),
  );
  expect(html).toContain('role="listbox"');
  expect(html.match(/role="option"/g)).toHaveLength(2);
  expect(html).toContain('Chat Output');
  expect(html).toContain('Chat · Value</small>');
  expect(html).toContain('Chat · N → text</small>');
  expect(html).toContain('aria-label="Filter node types"');
  // 900 is past the canvas edge (500 wide, 240 for the picker): clamped to 260.
  expect(html).toContain('left:260px');
});

it('says so when nothing accepts the connection', () => {
  expect(render(picker([]))).toContain('No node type accepts this connection.');
});

it('as a quick add (no connection) shows the category alone and names itself for a plain add', () => {
  const { from: _from, ...quick } = picker([{ descriptor: descriptor('counter', 'Counter'), coerce: false }]);
  const html = render(quick);
  expect(html).toContain('aria-label="Add a node"');
  expect(html).toContain('aria-label="Nodes"');
  expect(html).toContain('>Chat</small>');
  expect(html).not.toContain('·');
  expect(render({ ...quick, candidates: [] })).toContain('No node matches.');
});
