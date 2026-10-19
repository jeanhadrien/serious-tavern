import { useEffect } from 'react';
import type { ViewKey } from '../layout/derive.js';
import { ITEM_SOURCES } from '../layout/itemSources.js';
import { RESOURCE_IDS, type ResourceId } from '../layout/state.js';
import { escapeStep, isFieldElement } from './escape.js';
import { areaOf, closeNewestLayer, layerCount, runArea } from './escapeRegistry.js';
import { matchShortcut } from './shortcuts.js';

const viewSection = (key: ViewKey | undefined) =>
  key ? document.querySelector<HTMLElement>(`section.view[data-view="${key}"]`) : null;

/** The resource of an `editor:<resource>` view. */
const editorResource = (key: ViewKey | undefined): ResourceId | undefined => {
  const resource = key?.startsWith('editor:') ? key.slice('editor:'.length) : undefined;
  return RESOURCE_IDS.find((id) => id === resource);
};

/**
 * The view that has the keyboard: the focused element's view. With focus on the page itself (a click on a part of
 * a view that cannot take focus) it is the view of the last pointer press. A hidden view never has it.
 */
function focusedView(lastPointer: ViewKey | undefined): ViewKey | undefined {
  const active = document.activeElement;
  const key = active && active !== document.body ? areaOf(active) : lastPointer;
  return viewSection(key)?.hidden === false ? key : undefined;
}

function onEscape(event: KeyboardEvent, lastPointer: ViewKey | undefined) {
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target instanceof Element ? event.target : null;
  const step = escapeStep({
    handled: event.defaultPrevented,
    inDialog: !!target?.closest('dialog[open]'),
    layers: layerCount(),
    inField: isFieldElement(target),
  });
  if (step === 'layer') {
    closeNewestLayer();
  } else if (step === 'leaveField') {
    // Focus goes to the field's view, not the page, so the next Escape still knows where it is.
    const section = target?.closest<HTMLElement>('[data-view]');
    if (section) section.focus();
    else (target as HTMLElement | null)?.blur();
  } else if (step === 'area') {
    const view = focusedView(lastPointer);
    if (!view || !runArea(view)) return;
  } else {
    return;
  }
  event.preventDefault();
}

function onSave(event: KeyboardEvent, lastPointer: ViewKey | undefined) {
  event.preventDefault(); // never the browser's "save page"
  const resource = editorResource(focusedView(lastPointer));
  if (resource) void ITEM_SOURCES[resource]?.editor.save();
}

/**
 * The app's one keyboard listener (call it once, in the shell): Escape and the shortcuts of `SHORTCUTS`. It is on the
 * document in the bubble phase, so React's handlers on the root run first and a field that acted has already
 * called `preventDefault()`.
 */
export function useKeyboard() {
  useEffect(() => {
    let lastPointer: ViewKey | undefined;
    const onPointer = (event: PointerEvent) => {
      lastPointer = event.target instanceof Element ? areaOf(event.target) : undefined;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') onEscape(event, lastPointer);
      else if (matchShortcut(event) === 'save') onSave(event, lastPointer);
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
