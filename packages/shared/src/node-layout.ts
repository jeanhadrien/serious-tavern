type Point = { x: number; y: number };
type LayoutNode = { id: string; position?: Point | undefined };
type LayoutEdge = { source: string; target: string };

// Sized for the editor's node cards: about 230 wide, and up to about 220 tall for a node with many ports. A column
// leaves room for the connections between two columns; a row for the tallest usual node.
const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 240;

/**
 * Gives a position to every node that has none, so a workflow written without coordinates (by an agent, say) opens
 * readable in the editor. Nodes that already have a position are returned untouched.
 *
 * The nodes without one are laid out as their own graph, left to right: a column per depth (the longest chain of
 * connections leading to the node), and inside a column the order of the nodes they are fed by, to keep the
 * connections from crossing needlessly. The block starts below every node that already has a position, so nothing
 * overlaps; with none, it starts at the origin. Pure and deterministic: the same input gives the same positions.
 */
export function layoutNodes<N extends LayoutNode>(nodes: N[], edges: LayoutEdge[]): (N & { position: Point })[] {
  const loose = nodes.filter((node) => !node.position);
  if (!loose.length) return nodes as (N & { position: Point })[];
  const placed = nodes.flatMap((node) => (node.position ? [node.position] : []));
  const origin = placed.length
    ? { x: Math.min(...placed.map((p) => p.x)), y: Math.max(...placed.map((p) => p.y)) + ROW_HEIGHT }
    : { x: 0, y: 0 };
  const cells = arrange(
    loose.map((node) => node.id),
    edges,
  );
  return nodes.map((node) => {
    const cell = cells.get(node.id);
    if (node.position || !cell) return node as N & { position: Point };
    return { ...node, position: { x: origin.x + cell.column * COLUMN_WIDTH, y: origin.y + cell.row * ROW_HEIGHT } };
  });
}

/** The column and row of each id, from the connections between those ids alone. */
function arrange(ids: string[], edges: LayoutEdge[]): Map<string, { column: number; row: number }> {
  const feeders = new Map(ids.map((id) => [id, [] as string[]]));
  for (const { source, target } of edges)
    if (source !== target && feeders.has(source) && feeders.has(target)) feeders.get(target)!.push(source);

  // A node sits one column after its deepest feeder. A node in a loop never gets all its feeders placed, so what is
  // left after the first passes is placed after the feeders it does have.
  const column = new Map<string, number>();
  const place = (id: string) => column.set(id, Math.max(-1, ...feeders.get(id)!.map((f) => column.get(f) ?? -1)) + 1);
  for (let progressed = true; progressed; ) {
    progressed = false;
    for (const id of ids)
      if (!column.has(id) && feeders.get(id)!.every((feeder) => column.has(feeder))) {
        place(id);
        progressed = true;
      }
  }
  for (const id of ids) if (!column.has(id)) place(id);

  // Left to right, a node goes where the average row of its feeders is; ties keep the order of `ids`.
  const cells = new Map<string, { column: number; row: number }>();
  const columns = Math.max(...column.values()) + 1;
  for (let c = 0; c < columns; c++) {
    const average = (id: string) => {
      const rows = feeders.get(id)!.flatMap((f) => (cells.has(f) ? [cells.get(f)!.row] : []));
      return rows.length ? rows.reduce((sum, row) => sum + row, 0) / rows.length : 0;
    };
    const inColumn = ids
      .filter((id) => column.get(id) === c)
      .map((id, index) => ({ id, index, key: average(id) }))
      .sort((x, y) => x.key - y.key || x.index - y.index);
    for (const [row, { id }] of inColumn.entries()) cells.set(id, { column: c, row });
  }
  return cells;
}
