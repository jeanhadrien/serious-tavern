import type { NodeTypeDescriptor } from '@st/shared';

type Orderable = Pick<NodeTypeDescriptor, 'category' | 'label'>;

/** The one order node types are listed in (palette, connect picker, quick add): by category, then label. */
export const compareTypes = (a: Orderable, b: Orderable): number =>
  a.category.localeCompare(b.category) || a.label.localeCompare(b.label);

/** The types split by category, in `compareTypes` order: the palette's groups. */
export function groupByCategory(
  types: readonly NodeTypeDescriptor[],
): { category: string; types: NodeTypeDescriptor[] }[] {
  const groups: { category: string; types: NodeTypeDescriptor[] }[] = [];
  for (const type of [...types].sort(compareTypes)) {
    const last = groups.at(-1);
    if (last?.category === type.category) last.types.push(type);
    else groups.push({ category: type.category, types: [type] });
  }
  return groups;
}
