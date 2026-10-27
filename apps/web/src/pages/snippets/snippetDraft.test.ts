import { expect, it } from 'vitest';
import type { Snippet } from '@st/shared';
import { classifySnippetChange, draftToBody, newSnippetName, toDraft } from './snippetDraft.js';

const snippet = (extra: Partial<Snippet> = {}): Snippet => ({
  id: 's1',
  name: 'tone',
  text: 'Speak softly.',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...extra,
});

it('turns a draft into a write body, trimming the name and dropping a blank description', () => {
  expect(draftToBody({ name: ' tone ', description: '  ', text: 'x' })).toEqual({
    ok: true,
    body: { name: 'tone', text: 'x' },
  });
  expect(draftToBody({ name: 'tone', description: 'Voice', text: '' })).toEqual({
    ok: true,
    body: { name: 'tone', description: 'Voice', text: '' },
  });
  expect(draftToBody({ name: 'two words', description: '', text: '' }).ok).toBe(false);
});

it('picks the first free default name', () => {
  expect(newSnippetName([])).toBe('snippet');
  expect(newSnippetName(['snippet', 'snippet2'])).toBe('snippet3');
});

it('reloads a clean draft changed on disk and reports a conflict for a dirty one', () => {
  const saved = snippet();
  const onDisk = snippet({ text: 'Shout.' });
  expect(classifySnippetChange({ snippet: saved, draft: toDraft(saved) }, [onDisk])).toEqual({
    kind: 'reload',
    item: onDisk,
  });
  const dirty = { ...toDraft(saved), text: 'Whisper.' };
  expect(classifySnippetChange({ snippet: saved, draft: dirty }, [onDisk]).kind).toBe('conflict');
  // The editor's own save, seen before its response, is a reload.
  expect(classifySnippetChange({ snippet: saved, draft: toDraft(onDisk) }, [onDisk]).kind).toBe('reload');
});
