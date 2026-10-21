import type { NodeTypeDescriptor } from '@st/shared';

type Orderable = Pick<NodeTypeDescriptor, 'category' | 'label'>;

/** The one order node types are listed in (palette, connect picker, quick add): by category, then label. */
export const compareTypes = (a: Orderable, b: Orderable): number =>
  a.category.localeCompare(b.category) || a.label.localeCompare(b.label);
