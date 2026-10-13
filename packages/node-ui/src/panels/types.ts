import type { ReactNode } from 'react';
import type { Character, NodeTypeDescriptor, Preset, ProviderView } from '@st/shared';

export type NodePanelContext = {
  presets: readonly Preset[];
  characters: readonly Character[];
  providers: readonly Pick<ProviderView, 'id' | 'name'>[];
  renderLink?(to: string, label: string): ReactNode;
};

export type NodeConfigPanelProps = {
  descriptor: NodeTypeDescriptor;
  config: Record<string, unknown>;
  onChange(config: Record<string, unknown>): void;
  context?: NodePanelContext;
};
