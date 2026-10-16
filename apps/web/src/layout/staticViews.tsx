import type { ReactNode } from 'react';
import { CharacterList, Characters, PersonaList, Personas } from '../pages/Entities.js';
import { Presets } from '../pages/Presets.js';
import { Settings } from '../pages/Settings.js';
import { Workflows } from '../pages/Workflows.js';
import { CollectionListView } from '../pages/collections/CollectionListView.js';
import { Collections } from '../pages/collections/Collections.js';
import { PresetListView } from '../pages/presets/PresetListView.js';
import { ProviderListView } from '../pages/providers/ProviderListView.js';
import { Providers } from '../pages/providers/Providers.js';
import { StateDefinitionListView } from '../pages/stateDefinitions/StateDefinitionListView.js';
import { StateDefinitions } from '../pages/stateDefinitions/StateDefinitions.js';
import { WorkflowList } from '../pages/workflows/WorkflowList.js';
import {
  characterEditorStore,
  collectionEditorStore,
  personaEditorStore,
  presetEditorStore,
  providerEditorStore,
  stateDefinitionEditorStore,
  workflowEditorStore,
} from '../stores/index.js';
import type { ViewKey } from './derive.js';

// Views that take no props are created once: the shell re-renders on every streamed chat token,
// and a stable element lets React skip re-rendering these pages (the workflow canvas above all).
export const STATIC_VIEWS = {
  'list:workflows': <WorkflowList />,
  'list:presets': <PresetListView />,
  'list:providers': <ProviderListView />,
  'list:stateDefinitions': <StateDefinitionListView />,
  'list:characters': <CharacterList />,
  'list:personas': <PersonaList />,
  'list:collections': <CollectionListView />,
  'editor:workflows': <Workflows />,
  'editor:presets': <Presets />,
  'editor:providers': <Providers />,
  'editor:stateDefinitions': <StateDefinitions />,
  'editor:settings': <Settings />,
  'editor:characters': <Characters />,
  'editor:personas': <Personas />,
  'editor:collections': <Collections />,
} satisfies Partial<Record<ViewKey, ReactNode>>;

// Editors report their unsaved changes here; the shell shows them as a dot on the resource's icon.
export const DIRTY_SOURCES = {
  workflows: workflowEditorStore,
  presets: presetEditorStore,
  providers: providerEditorStore,
  stateDefinitions: stateDefinitionEditorStore,
  characters: characterEditorStore,
  personas: personaEditorStore,
  collections: collectionEditorStore,
};
