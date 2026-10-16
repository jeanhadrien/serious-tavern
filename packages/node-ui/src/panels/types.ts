import type { ReactNode } from 'react';
import type {
  Character,
  CollectionSummary,
  NodeTypeDescriptor,
  Preset,
  ProviderModelList,
  ProviderView,
  StateDefinition,
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
  /** Authored collections for Recall and Draw; ids without a record show as unknown. */
  collections?: readonly Pick<CollectionSummary, 'id' | 'name'>[];
  renderLink?(to: string, label: string): ReactNode;
  /** State definitions (whole records) for the State panels and the `{{state.*}}` hints in template fields. */
  stateDefinitions?: readonly StateDefinition[];
  /** Chat settings the open workflow declares, hinted as `{{settings.<key>}}` in template fields. */
  settings?: readonly Pick<WorkflowSetting, 'key' | 'type' | 'description'>[];
};

export type NodeConfigPanelProps = {
  descriptor: NodeTypeDescriptor;
  config: Record<string, unknown>;
  onChange(config: Record<string, unknown>): void;
  context?: NodePanelContext;
};
