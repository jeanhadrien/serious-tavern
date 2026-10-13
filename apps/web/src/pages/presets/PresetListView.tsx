import { useLayoutActions } from '../../layout/LayoutActions.js';
import { presetEditorStore, presetsStore, useEditorState, useList } from '../../stores/index.js';
import { PresetList } from './PresetList.js';
import { createPreset, deletePreset, duplicatePreset } from './presetActions.js';

/** The preset list shown in L, wired to the shared preset list and the editor in M. */
export function PresetListView() {
  const presets = useList(presetsStore);
  const { currentId, dirty } = useEditorState(presetEditorStore);
  const { openEditor } = useLayoutActions();
  const showEditor = () => openEditor('presets');
  return (
    <PresetList
      presets={presets}
      selectedId={currentId}
      dirtyId={dirty ? currentId : undefined}
      onSelect={(preset) => {
        presetEditorStore.open(structuredClone(preset));
        showEditor();
      }}
      onCreate={() => void createPreset().then((ok) => ok && showEditor())}
      onDuplicate={(preset) => void duplicatePreset(preset).then((ok) => ok && showEditor())}
      onDelete={(preset) => void deletePreset(preset)}
    />
  );
}
