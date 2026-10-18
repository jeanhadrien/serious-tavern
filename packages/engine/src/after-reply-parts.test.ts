import { afterEach, describe, expect, it } from 'vitest';
import { prepareWorkflow, validateWorkflow } from './prepare.js';
import { edge, graph, node } from './test-collections.js';
import { bump, register, testType, unregister, write } from './test-post.js';
import { sceneDefinition, stateResources } from './test-state.js';

const resources = stateResources(sceneDefinition);
afterEach(unregister);

const partsOf = async (nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[]) => {
  register(testType('pass-test'));
  const { prepared, errors } = await prepareWorkflow(graph(nodes, edges), resources);
  expect(errors).toEqual([]);
  const { parts } = prepared!;
  return { reply: [...parts.reply].sort(), post: [...parts.post].sort(), postSinks: [...parts.postSinks] };
};

describe('the parts of a workflow', () => {
  const base = [node('input', 'chat-input'), node('output', 'chat-output')];
  const reply = edge('input', 'message', 'output', 'value');

  it.each([
    [
      'no After Reply: every sink is a reply sink and nothing runs after',
      [...base, bump('bump')],
      [reply],
      { reply: ['bump', 'input', 'output'], post: [], postSinks: [] },
    ],
    [
      'After Reply into a State Write: the write is a post sink and the reply part has the rest',
      [...base, node('after', 'after-reply'), bump('bump')],
      [reply, edge('after', 'turn', 'bump', 'when')],
      { reply: ['input', 'output'], post: ['after', 'bump'], postSinks: ['bump'] },
    ],
    [
      'After Reply through another node into a State Write',
      [...base, node('after', 'after-reply'), node('pass', 'pass-test'), write('note', 'note', 'set')],
      [reply, edge('after', 'text', 'pass', 'value'), edge('pass', 'value', 'note', 'value')],
      { reply: ['input', 'output'], post: ['after', 'note', 'pass'], postSinks: ['note'] },
    ],
    [
      'two After Reply nodes feeding two State Writes, listed in workflow order',
      [...base, node('a1', 'after-reply'), node('a2', 'after-reply'), bump('w2'), bump('w1')],
      [reply, edge('a1', 'turn', 'w1', 'when'), edge('a2', 'turn', 'w2', 'when')],
      { reply: ['input', 'output'], post: ['a1', 'a2', 'w1', 'w2'], postSinks: ['w2', 'w1'] },
    ],
    [
      'a node upstream of both a Chat Output and a post State Write is in both parts',
      [...base, node('shared', 'pass-test'), node('after', 'after-reply'), write('note', 'note', 'set')],
      [
        edge('input', 'message', 'shared', 'value'),
        edge('shared', 'value', 'output', 'value'),
        edge('shared', 'value', 'note', 'value'),
        edge('after', 'turn', 'note', 'when'),
      ],
      { reply: ['input', 'output', 'shared'], post: ['after', 'input', 'note', 'shared'], postSinks: ['note'] },
    ],
    [
      'a State Write that does not depend on After Reply stays in the reply part',
      [...base, node('after', 'after-reply'), bump('early'), bump('late')],
      [reply, edge('after', 'turn', 'late', 'when')],
      { reply: ['early', 'input', 'output'], post: ['after', 'late'], postSinks: ['late'] },
    ],
    [
      'an After Reply nothing depends on is in neither part',
      [...base, node('after', 'after-reply'), node('dead', 'pass-test')],
      [reply, edge('after', 'text', 'dead', 'value')],
      { reply: ['input', 'output'], post: [], postSinks: [] },
    ],
    [
      'a sink that needs both a reply node and After Reply is a post sink with both upstreams',
      [...base, node('after', 'after-reply'), write('note', 'note', 'set'), node('both', 'merge')],
      [
        edge('input', 'message', 'both', 'a'),
        edge('after', 'text', 'both', 'b'),
        edge('both', 'value', 'note', 'value'),
        reply,
      ],
      { reply: ['input', 'output'], post: ['after', 'both', 'input', 'note'], postSinks: ['note'] },
    ],
  ])('%s', async (_, nodes, edges, expected) => {
    expect(await partsOf(nodes, edges)).toEqual(expected);
  });

  it('keeps the union of both parts as the nodes that can run', async () => {
    register(testType('pass-test'));
    const { prepared } = await prepareWorkflow(
      graph(
        [...base, node('after', 'after-reply'), bump('bump'), node('dead', 'pass-test')],
        [reply, edge('after', 'turn', 'bump', 'when'), edge('input', 'message', 'dead', 'value')],
      ),
      resources,
    );
    expect([...prepared!.reachable].sort()).toEqual(['after', 'bump', 'input', 'output']);
  });
});

describe('validation', () => {
  const names = (issues: { message: string }[]) => issues.map((issue) => issue.message);

  it.each([
    ['directly', [edge('after', 'text', 'n-out', 'value')]],
    ['through another node', [edge('after', 'text', 'n-pass', 'value'), edge('n-pass', 'value', 'n-out', 'value')]],
    ['through a State Write', [edge('after', 'turn', 'n-bump', 'when'), edge('n-bump', 'value', 'n-out', 'value')]],
  ])('rejects a Chat Output that depends on After Reply %s', async (_, edges) => {
    register(testType('pass-test'));
    const workflow = graph(
      [
        node('n-in', 'chat-input'),
        node('n-out', 'chat-output'),
        node('after', 'after-reply'),
        node('n-pass', 'pass-test'),
        bump('n-bump'),
      ],
      edges,
    );
    const { errors, prepared } = await prepareWorkflow(workflow, resources);
    expect(prepared).toBeUndefined();
    expect(errors).toEqual([
      {
        message: `"Chat Output #1 (chat-output)" can't depend on "After Reply #1 (after-reply)": replies are written before it runs.`,
        nodeIds: ['n-out', 'after'],
      },
    ]);
    expect(await validateWorkflow(workflow, resources)).toEqual(errors);
  });

  it('puts the nodes in the issue, never their ids in its text', async () => {
    const [issue] = await validateWorkflow(
      graph(
        [node('n-in', 'chat-input'), node('n-out', 'chat-output'), node('after', 'after-reply')],
        [edge('after', 'text', 'n-out', 'value')],
      ),
    );
    expect(issue?.message).not.toMatch(/n-out|n-in|after(?!-)/);
    expect(issue?.message).toContain('Chat Output #1 (chat-output)');
    expect(issue?.message).toContain('After Reply #1 (after-reply)');
    expect(issue?.edgeId).toBeUndefined();
  });

  it('gives one issue per offending Chat Output and leaves the others alone', async () => {
    const issues = await validateWorkflow(
      graph(
        [
          node('in', 'chat-input'),
          node('good', 'chat-output'),
          node('bad1', 'chat-output'),
          node('after', 'after-reply'),
          node('bad2', 'chat-output'),
        ],
        [
          edge('in', 'message', 'good', 'value'),
          edge('after', 'text', 'bad1', 'value'),
          edge('after', 'text', 'bad2', 'value'),
        ],
      ),
    );
    expect(issues.map((issue) => issue.nodeIds)).toEqual([
      ['bad1', 'after'],
      ['bad2', 'after'],
    ]);
    expect(names(issues)[1]).toContain('Chat Output #3 (chat-output)');
  });

  it('names the first After Reply upstream of the output, in workflow order', async () => {
    const issues = await validateWorkflow(
      graph(
        [
          node('in', 'chat-input'),
          node('out', 'chat-output'),
          node('a1', 'after-reply'),
          node('a2', 'after-reply'),
          node('both', 'merge'),
        ],
        [edge('a2', 'text', 'both', 'a'), edge('a1', 'text', 'both', 'b'), edge('both', 'value', 'out', 'value')],
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.nodeIds).toEqual(['out', 'a1']);
    expect(names(issues)[0]).toContain('After Reply #1 (after-reply)');
  });

  it('accepts several After Reply nodes, and After Reply next to a Chat Output in the same workflow', async () => {
    const issues = await validateWorkflow(
      graph(
        [
          node('in', 'chat-input'),
          node('out', 'chat-output'),
          node('a1', 'after-reply'),
          node('a2', 'after-reply'),
          bump('w1'),
          bump('w2'),
        ],
        [edge('in', 'message', 'out', 'value'), edge('a1', 'turn', 'w1', 'when'), edge('a2', 'turn', 'w2', 'when')],
      ),
      resources,
    );
    expect(issues).toEqual([]);
  });

  it('still reports a cycle that includes After Reply, without hanging', async () => {
    register(testType('pass-test'));
    const issues = await validateWorkflow(
      graph(
        [
          node('in', 'chat-input'),
          node('out', 'chat-output'),
          node('after', 'after-reply'),
          node('p1', 'pass-test'),
          node('p2', 'pass-test'),
        ],
        [
          edge('after', 'text', 'p1', 'value'),
          edge('p1', 'value', 'p2', 'value'),
          edge('p2', 'value', 'p1', 'value'),
          edge('p2', 'value', 'out', 'value'),
        ],
      ),
    );
    expect(names(issues)).toContain('The connections form a loop; a workflow cannot contain a cycle.');
  });

  it('accepts the ports of After Reply on the connections it is meant for', async () => {
    register(testType('pass-test'));
    const issues = await validateWorkflow(
      graph(
        [
          node('in', 'chat-input'),
          node('out', 'chat-output'),
          node('after', 'after-reply'),
          bump('b'),
          write('n', 'note', 'set'),
          node('p', 'pass-test'),
        ],
        [
          edge('in', 'message', 'out', 'value'),
          edge('after', 'turn', 'b', 'value'),
          edge('after', 'text', 'n', 'value'),
          edge('after', 'replies', 'p', 'value'),
          edge('p', 'value', 'n', 'when'),
        ],
      ),
      resources,
    );
    expect(issues).toEqual([]);
  });

  it('reports an edge out of an output After Reply does not have', async () => {
    const [issue] = await validateWorkflow(
      graph(
        [node('in', 'chat-input'), node('out', 'chat-output'), node('after', 'after-reply'), bump('b')],
        [edge('in', 'message', 'out', 'value'), edge('after', 'summary', 'b', 'when')],
      ),
      resources,
    );
    expect(issue?.message).toContain('has no output called "summary". Available outputs: replies, text, turn.');
  });
});
