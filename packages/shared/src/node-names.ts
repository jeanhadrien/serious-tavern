/**
 * Builds a human-readable label for a node in validation messages, e.g.
 * `LLM #2 (llm)`. The index is the 1-based position of the node among nodes of
 * the same type in array order, so duplicate types stay distinguishable. When
 * the id is unknown, it is returned unchanged.
 */
export function nodeDisplayName(
  nodes: ReadonlyArray<{ id: string; type: string }>,
  labelOf: (type: string) => string,
  id: string,
): string {
  const index = nodes.findIndex((node) => node.id === id);
  if (index === -1) return id;
  const target = nodes[index]!;
  let position = 0;
  for (let i = 0; i <= index; i++) if (nodes[i]!.type === target.type) position++;
  return `${labelOf(target.type)} #${position} (${target.type})`;
}
