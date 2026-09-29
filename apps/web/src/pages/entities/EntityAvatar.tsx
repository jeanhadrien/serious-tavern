import { useRef } from 'react';
import type { Character, Persona } from '@st/shared';
import { charactersApi, personasApi } from '../../api.js';

type EntityType = 'characters' | 'personas';

export function EntityPortrait({
  type,
  item,
  large = false,
}: {
  type: EntityType;
  item: Character | Persona;
  large?: boolean;
}) {
  const url =
    typeof item.avatar === 'string' ? (type === 'characters' ? charactersApi : personasApi).avatarUrl(item.id) : '';
  return url ? (
    <img src={`${url}?v=${item.updatedAt}`} />
  ) : (
    <span className={`avatar-fallback${large ? ' large' : ''}`}>{item.name.slice(0, 1).toUpperCase()}</span>
  );
}

export function EntityAvatar({
  type,
  item,
  onUpload,
}: {
  type: EntityType;
  item: Character | Persona;
  onUpload: (file?: File) => Promise<void>;
}) {
  const avatarInput = useRef<HTMLInputElement>(null);
  return (
    <div className="entity-avatar">
      <EntityPortrait type={type} item={item} large />
      <button onClick={() => avatarInput.current?.click()}>Change avatar</button>
      <input
        ref={avatarInput}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(event) => {
          void onUpload(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}
