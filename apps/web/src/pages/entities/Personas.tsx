import { personaSchema, type Persona } from '@st/shared';
import { personasApi } from '../../api.js';
import { alerts } from '../../alerts/index.js';
import { useEntityEditor } from './useEntityEditor.js';
import { EntityPage } from './EntityPage.js';
import { EntityList } from './EntityList.js';
import { EntityDetail } from './EntityDetail.js';
import { EntityAvatar } from './EntityAvatar.js';
import { PersonaFields } from './PersonaFields.js';

export function Personas() {
  const editor = useEntityEditor<Persona>({
    label: 'Persona',
    list: personasApi.list,
    create: () => personasApi.create({ name: 'New persona' }),
    save: (draft) => personasApi.update(draft.id, draft),
    delete: personasApi.delete,
    import: personasApi.import,
    uploadAvatar: personasApi.uploadAvatar,
    validate: (draft) => {
      const parsed = personaSchema.safeParse(draft);
      if (!parsed.success) alerts.error('Enter a valid persona name');
      return parsed.success;
    },
    prepareFiles: (files) => {
      const images = files.filter(
        (file) => file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name),
      );
      if (!images.length) alerts.error('Choose image files to create personas');
      return images;
    },
    imported: (count) => alerts.success(`Created ${count} persona${count === 1 ? '' : 's'} from images`),
    failed: (failures) =>
      alerts.error('Some persona images could not be imported', {
        details: failures.map((item) => `${item.filename}: ${item.error.message}`).join('\n'),
      }),
  });
  const { draft } = editor;
  return (
    <EntityPage dropLabel="Drop an image to create a persona" importFiles={editor.importFiles}>
      <EntityList
        type="personas"
        title="Personas"
        importLabel="Create from image"
        accept="image/png,image/jpeg,image/gif,image/webp"
        list={editor.list}
        selectedId={draft?.id}
        dirty={editor.dirty}
        onSelect={editor.choose}
        onCreate={editor.create}
        onImport={editor.importFiles}
      />
      {draft ? (
        <EntityDetail title={draft.name} dirty={editor.dirty} onDelete={editor.remove} onSave={editor.save}>
          <div className="persona-form">
            <EntityAvatar type="personas" item={draft} onUpload={editor.uploadAvatar} />
            <PersonaFields draft={draft} change={editor.change} />
          </div>
        </EntityDetail>
      ) : (
        <div className="empty-state">
          <h1>Personas</h1>
          <p>Select or create a persona, or drop an image to get started.</p>
        </div>
      )}
    </EntityPage>
  );
}
