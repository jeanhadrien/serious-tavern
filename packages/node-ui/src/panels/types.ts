import type { ReactNode } from 'react';
import type { ApiResponse, Character, NodeTypeDescriptor, Preset } from '@st/shared';

export type NodePanelContext = {
  presets: readonly Preset[];
  characters: readonly Character[];
  providers: readonly ApiResponse<'listProviders'>[number][];
  renderLink?(to: string, label: string): ReactNode;
};

export type NodeConfigPanelProps = {
  descriptor: NodeTypeDescriptor;
  config: Record<string, unknown>;
  onChange(config: Record<string, unknown>): void;
  context?: NodePanelContext;
};
