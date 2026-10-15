import type { ReactNode } from 'react';
import type {
  Character,
  NodeTypeDescriptor,
  Preset,
  ProviderModelList,
  ProviderView,
  WorkflowSetting,
} from '@st/shared';

export type NodePanelContext = {
  presets: readonly Preset[];
  characters: readonly Character[];
  providers: readonly Pick<ProviderView, 'id' | 'name'>[];
  /**
   * Loads the models a provider serves; `refresh` bypasses the host's cache. The host owns the request (node-ui
   * never calls the API); it should reject with a readable message. Without it the Model field is plain text.
   */
  loadModels?(providerId: string, options?: { refresh?: boolean }): Promise<ProviderModelList>;
  renderLink?(to: string, label: string): ReactNode;
  /** Chat settings the open workflow declares, hinted as `{{settings.<key>}}` in template fields. */
  settings?: readonly Pick<WorkflowSetting, 'key' | 'type' | 'description'>[];
};

export type NodeConfigPanelProps = {
  descriptor: NodeTypeDescriptor;
  config: Record<string, unknown>;
  onChange(config: Record<string, unknown>): void;
  context?: NodePanelContext;
};
