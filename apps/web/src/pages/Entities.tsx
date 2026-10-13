import './entities/entities.css';
import { EntityListView } from './entities/EntityListView.js';
import { characterKind, personaKind } from './entities/entityKinds.js';

export { Characters } from './entities/Characters.js';
export { Personas } from './entities/Personas.js';

export const CharacterList = () => <EntityListView kind={characterKind} />;
export const PersonaList = () => <EntityListView kind={personaKind} />;
