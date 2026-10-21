# Step 7a: composer draft per chat, and copy a message

Spec: `docs/dev/design/FRONTEND-UX.md`, Features in this round.

## 1. Composer draft per chat

Today the composer's text lives in the chat view's state. Find where `content`/`onChange` of `pages/chat/Composer.tsx` comes from (`pages/Chat.tsx` or `useChat`).

- `pages/chat/composerDraft.ts` (pure apart from storage, tested):
  - `loadDraft(sessionId): string` and `saveDraft(sessionId, text)` over `localStorage` key `st.composer.<sessionId>`. An empty text removes the key. Every access is guarded like `layout/widths.ts` (try/catch; missing storage reads as `''`).
  - `pruneDrafts(existingIds)` removes the keys of chats that no longer exist. Call it when the sessions list loads, so deleted chats don't leave drafts behind.
- Behaviour:
  - opening a chat (and reloading the page with it open) restores its draft;
  - typing saves it, debounced by about 300 ms, and flushed on chat switch and on `pagehide`;
  - switching to another chat shows that chat's draft;
  - sending clears it: the stored draft is removed when the send starts, and the text is restored only if the send fails before the user message was stored, i.e. where today's code already puts the text back on failure, if it does.
- Never put the draft in the streamed-token path: the composer must not re-render per token because of this (see the `useChat` notes in `AGENTS.md`).
- Tests: load and save round trip, empty removes, prune, and broken storage (a throwing `localStorage`) falls back silently.

## 2. Copy a message

- `pages/chat/MessageActions.tsx`: a **Copy** icon button (lucide `Copy`, `aria-label`/`title` "Copy message"). It's shown for every message with content, also when edit/delete aren't offered (check where `MessageActions` is rendered in `ChatMessageView.tsx`; it may need to render for messages without `onEdit`/`onDelete`, with only Copy).
- It copies the raw content (Markdown), never the rendered HTML or the reasoning, through `navigator.clipboard.writeText`. Success shows `alerts.success('Copied')` with a short timeout (1500 ms); failure or a missing clipboard API shows `alerts.error('Could not copy the message')`.
- Streaming rows (`status: 'streaming'`) don't show Copy.
- Put the copy call in a small module (`pages/chat/copyText.ts`) so it can be tested with a fake clipboard.

## 3. Docs

- `README.md`: one sentence each in the chat section.
- `AGENTS.md`: under the `useChat` / chat notes, "the composer draft is per chat in `localStorage` (`composerDraft.ts`), never in the token path".
- `docs/dev/design/FRONTEND-UX.md` build order: mark 7a done.

## Done when

- `npm run check` passes.
- Live check (orchestrator):
  - type in chat A, switch to B and back: the text is kept;
  - reload: it is still there;
  - send: it is cleared;
  - Copy puts the Markdown in the clipboard (check with `navigator.clipboard.readText` in Playwright with clipboard permissions).
