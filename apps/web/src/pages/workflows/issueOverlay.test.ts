import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '@st/shared';
import { issueEdgeIds, issuesByNode, issueTargets, listedIssues } from './issueOverlay.js';

const issues: ValidationIssue[] = [
  { message: 'needs input', nodeIds: ['a'] },
  { message: 'bad wire', edgeId: 'e1', nodeIds: ['a', 'b'] },
  { message: 'dangling wire', edgeId: 'e2' },
  { message: 'a cycle' },
  { message: 'duplicate key', source: 'settings' },
];

describe('issue overlay', () => {
  it('leaves settings problems out of the list', () => {
    expect(listedIssues(issues).map((issue) => issue.message)).toEqual([
      'needs input',
      'bad wire',
      'dangling wire',
      'a cycle',
    ]);
  });

  it('collects the messages per node, once per issue', () => {
    const byNode = issuesByNode([...issues, { message: 'twice', nodeIds: ['b', 'b'] }]);
    expect(byNode.get('a')).toEqual(['needs input', 'bad wire']);
    expect(byNode.get('b')).toEqual(['bad wire', 'twice']);
    expect(byNode.has('c')).toBe(false);
  });

  it('collects every connection named, not only the first', () => {
    expect([...issueEdgeIds(issues)]).toEqual(['e1', 'e2']);
  });

  describe('issueTargets', () => {
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'ghost' },
    ];
    it.each([
      ['a node issue', issues[0]!, { nodeIds: ['a'], edgeId: undefined }],
      ['a connection issue adds its ends once', issues[1]!, { nodeIds: ['a', 'b'], edgeId: 'e1' }],
      ['a connection named only by id', issues[2]!, { nodeIds: ['b', 'ghost'], edgeId: 'e2' }],
      ['an issue about the whole workflow', issues[3]!, { nodeIds: [], edgeId: undefined }],
      ['a connection that is not there', { message: 'x', edgeId: 'gone' }, { nodeIds: [], edgeId: undefined }],
    ])('%s', (_, issue, expected) => {
      expect(issueTargets(issue, edges)).toEqual(expected);
    });
  });
});
