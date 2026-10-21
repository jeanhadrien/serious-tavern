/**
 * The short names (`#1`, `#2`, ...) the model uses for collection items in one tool loop. Item ids
 * (`<execution>:<node>:<n>`) are long and models copy them badly. A handle is given the first time an item is shown
 * and kept for the loop; only an id the loop showed can be reached through a handle.
 */
export class ItemHandles {
  private readonly byId = new Map<string, string>();
  private readonly byHandle = new Map<string, string>();

  /** The handle of an item, minted on first sight. */
  handleFor(id: string): string {
    let handle = this.byId.get(id);
    if (handle === undefined) {
      handle = `#${this.byId.size + 1}`;
      this.byId.set(id, handle);
      this.byHandle.set(handle, id);
    }
    return handle;
  }

  /** The id behind a handle the loop showed (`#2`, or just `2`); undefined for any other text. */
  idOf(handle: string): string | undefined {
    const text = handle.trim();
    return this.byHandle.get(text.startsWith('#') ? text : `#${text}`);
  }
}
