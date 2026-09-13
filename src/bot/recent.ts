import type { LedgerRow } from "../types.js";

/**
 * Recently recorded entries, kept only to re-render a message nicely after an
 * undo or a category change.
 *
 * This is a convenience, never a source of truth: the sheet is. Undo and
 * category edits work purely from the id in the button, so they still function
 * after a restart — the message just gets a terser confirmation.
 */
export class RecentEntries {
  private readonly entries = new Map<string, LedgerRow>();

  constructor(private readonly capacity = 200) {}

  set(row: LedgerRow): void {
    this.entries.set(row.id, row);
    // Map preserves insertion order, so the first key is the oldest.
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  get(id: string): LedgerRow | null {
    return this.entries.get(id) ?? null;
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }
}
