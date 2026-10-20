// ============================================================
// PREFERENCE-CONTROLS.TS — the popup's preference controls
// ============================================================
// Every popup control that edits one stored preference used to be
// its own hand-written block: look the element up, paint it, attach
// a listener, read the value, normalize it, write it, say something
// about it. Nineteen of those blocks meant nineteen chances to
// forget the defensive lookup, the normalizer, or the write.
//
// This module is the one binder behind them (ADR-0037). A control is
// a ROW: which element it is, how it paints itself from the stored
// preferences, what patch a change produces, and — for the few that
// need one — a gate before the write, a rollback, and the line the
// status field should say afterwards. The rows themselves are
// declared in popup.ts, next to the markup they mirror.
//
// What it does NOT do: decide what a preference MEANS. The keys,
// the defaults and the normalizers are shared/extension-preferences.ts
// (one row per preference), and reading/writing storage is
// content/preferences.ts. A control can only name a field and hand
// over a value; it cannot invent a key.
// ============================================================

import type { ExtensionPreferences } from "../content/preferences";

/**
 * One control that edits a stored preference.
 *
 * `patch()` returning null means "this change stores nothing" — the losing
 * half of a radio pair, which the browser reports as a change too.
 */
export interface PreferenceControl {
  /** The element's id in popup.html. */
  id: string;
  /** The event that means the user changed it. `change` unless stated. */
  event?: "change" | "input";
  /** Paint this control from the stored preferences. */
  paint(preferences: ExtensionPreferences): void;
  /** The patch to store, or null when this change stores nothing. */
  patch(): Partial<ExtensionPreferences> | null;
  /** An asynchronous gate before the write. `false` cancels it. */
  beforeWrite?(patch: Partial<ExtensionPreferences>): Promise<boolean>;
  /** Undo the control's own state when a gate refused. */
  revert?(): void;
  /** What the status field says after a successful write. */
  status?(patch: Partial<ExtensionPreferences>): string | null;
  /** What it says when a gate refused — the one line the refusal deserves. */
  refused?(patch: Partial<ExtensionPreferences>): string | null;
}

/** What a control needs from the page it lives on. */
export interface PreferenceControlDeps {
  /** Persist one patch. The popup's own storage bridge. */
  write(patch: Partial<ExtensionPreferences>): Promise<void>;
  /** Put one line in the popup's status field. */
  say(message: string): void;
}

/** Paint every control from one preference snapshot. */
export function paintPreferenceControls(
  controls: readonly PreferenceControl[],
  preferences: ExtensionPreferences,
): void {
  for (const control of controls) control.paint(preferences);
}

/**
 * Wire every control's own event.
 *
 * The lookup is defensive, exactly as the hand-written blocks were: the popup
 * degrades to whatever the document actually contains, so a missing element is
 * a control that does nothing rather than a popup that throws on open.
 */
export function bindPreferenceControls(
  controls: readonly PreferenceControl[],
  deps: PreferenceControlDeps,
): void {
  for (const control of controls) {
    const element = document.getElementById(control.id);
    if (!element) continue;
    element.addEventListener(control.event ?? "change", () => {
      const patch = control.patch();
      if (!patch) return;
      void apply(control, patch, deps);
    });
  }
}

/** Run one control's change: the gate, the write, then the line about it. */
async function apply(
  control: PreferenceControl,
  patch: Partial<ExtensionPreferences>,
  deps: PreferenceControlDeps,
): Promise<void> {
  if (control.beforeWrite && !(await control.beforeWrite(patch))) {
    control.revert?.();
    const refusal = control.refused?.(patch);
    if (refusal) deps.say(refusal);
    return;
  }

  await deps.write(patch);
  const message = control.status?.(patch);
  if (message) deps.say(message);
}
