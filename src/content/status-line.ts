// ============================================================
// STATUS-LINE.TS — a panel tab's status field, as one thing
// ============================================================
// Each tab has ONE status field, and three things speak through it: the
// promise made while the grid is fetched, the summary of a finished run, and
// an error (a comparison that cannot run, a spreadsheet that failed to load).
// Before this module each writer found the element by id, set its text and
// assigned a class by hand — four call sites per tab, each free to pick the
// wrong weight, and the retirement notice guarded by comparing the TEXT the
// tab remembered writing.
//
// Here the element, the four KINDS it can be in and the class each kind means
// live together, and the line remembers what it last set. That memory is what
// the retirement replacement checks (`replace`), so "is the promise still the
// promise?" is a fact this module owns instead of a string comparison each tab
// repeats (ADR-0026, ADR-0029).
//
// Pure DOM, no browser API: both tabs construct one from the id they already
// use for their markup.
// ============================================================

/** What the line is currently saying, and therefore how it looks. */
export type StatusKind =
  /** A promise: the grid is being fetched and a result will follow. */
  | "waiting"
  /** A finished run's summary. */
  | "summary"
  /** Something went wrong (the run itself, or the export). */
  | "error"
  /** A one-line explanation with no cause claimed — the retirement notice. */
  | "notice";

/**
 * The class each kind paints. The base class is on every one of them, so the
 * spacing never changes with the kind — only the tint does. `notice` keeps the
 * untinted base on purpose: the badge carries the stop's own account, and the
 * tab's line is the quieter half of it.
 */
const KIND_CLASS: Record<StatusKind, string> = {
  waiting: "ch-comparer-status ch-comparer-status-info",
  summary: "ch-comparer-status ch-comparer-status-info",
  error: "ch-comparer-status ch-comparer-status-error",
  notice: "ch-comparer-status",
};

/** The empty line's class: the base one, no tint. */
const IDLE_CLASS = "ch-comparer-status";

/** One tab's status field. */
export interface StatusLine {
  /** The element this line speaks through. */
  readonly id: string;
  /**
   * Show `text` as `kind`, replacing whatever the line said.
   *
   * False when the element is not on the page — a detached panel, or a tab
   * that was never injected — which is the one condition a caller may act on.
   */
  set(kind: StatusKind, text: string): boolean;
  /**
   * Replace the line ONLY while it is still showing what this line last set as
   * `kind`.
   *
   * This is the retirement's rule: the tab promised a result as `waiting`, and
   * a summary or an error written since is the tab's real output, which a stop
   * arriving afterwards must not overwrite (ADR-0026).
   */
  replace(kind: StatusKind, next: { readonly kind: StatusKind; readonly text: string }): boolean;
  /** Empty the line and forget what it said. */
  clear(): void;
  /** What this line last set, or null when it is empty or was never used. */
  kind(): StatusKind | null;
}

/**
 * A line over the element with this id.
 *
 * The element is looked up on every call rather than captured: the panel is
 * re-injected when Angular re-renders its header, and a captured node would go
 * on being painted after the live one replaced it.
 */
export function createStatusLine(id: string): StatusLine {
  /** The kind this line last set itself. The guard `replace` reads. */
  let lastKind: StatusKind | null = null;

  function paint(kind: StatusKind, text: string): boolean {
    const el = document.getElementById(id);
    if (!el) return false;
    el.textContent = text;
    el.className = KIND_CLASS[kind];
    lastKind = kind;
    return true;
  }

  return {
    id,
    set: paint,
    replace(kind, next) {
      // Every writer goes through this line, so its own memory is the honest
      // answer to "has something else spoken since?" — no text to compare, and
      // no writer has to remember to unset a flag.
      if (lastKind !== kind) return false;
      // One replacement consumes the promise, whether or not the panel is still
      // on the page to paint it: a line left claiming to be `waiting` after the
      // element was torn down would let a later retirement write into whatever
      // element appears next.
      lastKind = null;
      return paint(next.kind, next.text);
    },
    clear() {
      lastKind = null;
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = "";
      el.className = IDLE_CLASS;
    },
    kind: () => lastKind,
  };
}
