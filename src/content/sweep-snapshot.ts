// ============================================================
// SWEEP-SNAPSHOT.TS — a resumable sweep survives the page it ran on
// ============================================================
// ADR-0023 made a year-wide sweep with masa still missing resumable from the
// rows it kept and their per-masa counts, but those lived in the isolated
// world's memory: a reload dropped them, and with them the only record of which
// masa the portal had already delivered. Finishing the year then meant fetching
// eleven months again, on a portal this project deliberately paces.
//
// Two states leave that record behind, and both are stored: a sweep the user
// STOPPED (whose file is named `-sebagian`) and a sweep that FINISHED with a
// masa the portal failed to deliver (whose file keeps its plain name while its
// year is still one month short). What makes rows resumable is masa still
// missing, not how the sweep ended — `sweepContentOf` asks `sweep.isResumable`,
// and the stop flag is carried as a fact about the rows, not as the ticket.
//
// Two halves, deliberately apart:
//
// - the SHAPE (`sweepContentOf`, `readSnapshot`, `snapshotAppliesTo`): pure, so
//   the guard that decides whether a stored blob may become a Run's rows is unit
//   tested rather than trusted. Nothing here reads storage;
// - the STORE (`createSweepSnapshotStore`): extension storage behind an injected
//   read/write/remove, guarded and best-effort. Persisting is an OPTIMIZATION, so
//   a refused write, a sweep too large to store or a snapshot past its window
//   ends in "no resume" and never in a page error.
//
// What is stored is exactly what a resume needs and nothing else. A snapshot
// carries no pending request: a comparison or an export queued before the stop
// was retired with its Run (ADR-0022, ADR-0027), and a reload must not
// resurrect one.
// ============================================================

import type { ExportSource } from "./page-context";
import type { RunResult } from "./run-lifecycle";
import { isResumable, type PeriodCount, type Sweep } from "./sweep";
import { browserAPI } from "./browser-shim";
import { debugError, debugWarn } from "./debug";

// ── Values ─────────────────────────────────────────────

/**
 * Bumped whenever the stored shape changes. A snapshot from an older version is
 * dropped rather than migrated: the rows it holds are reproducible by fetching
 * the missing masa again, which is what a resume does anyway.
 *
 * Version 2 carries the sweep's PLAN alongside its counts (sweep.ts), so a
 * version 1 blob — which had only the counts — is dropped rather than read as a
 * sweep with no plan and nothing to resume.
 */
export const SWEEP_SNAPSHOT_VERSION = 2;

/** The one extension-storage key a resumable stopped sweep lives under. */
export const SWEEP_SNAPSHOT_STORAGE_KEY = "cindiehSweepSnapshot";

/**
 * How long a stored half-sweep may be offered to a reloaded tab.
 *
 * A resume is a pause, not an archive. The portal's rows for a masa can grow
 * after it was fetched (an invoice filed late), and neither the portal's own
 * year check nor the merge can see that from the rows alone — so the offer
 * expires instead of silently producing a file that mixes last week's masa with
 * today's. A day covers the realistic case (a crashed tab, a browser restart
 * over lunch) and nothing longer.
 */
export const SWEEP_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How much serialized sweep may be stored.
 *
 * `storage.local` allows 10 MB in Chrome MV3; staying well under it leaves room
 * for the preferences and keeps a single write cheap. A sweep that does not fit
 * is NOT truncated — half a year's rows silently presented as the kept half
 * would make the resume's file short in a way the counts deny — it is simply not
 * persisted, and a reload loses the resume exactly as it did before this module.
 */
export const SWEEP_SNAPSHOT_MAX_CHARS = 4_000_000;

/**
 * A resumable sweep, as stored: the result's resumable part plus the stamp that
 * lets a read decide whether it is still worth offering.
 *
 * `source` is required, unlike `RunResult.source`: a snapshot whose page is
 * unknown could be offered on the wrong grid, and the grid is the one thing a
 * reload cannot reconstruct from the rows.
 */
export interface SweepSnapshot {
  version: number;
  /** When it was written, for the age window. */
  savedAt: number;
  /**
   * Whether these rows are a STOPPED sweep's kept half, and stored rather than
   * implied.
   *
   * Both resumable states carry counts, so the flag cannot be inferred from
   * them: `true` is the half a stop kept and what names its file `-sebagian`,
   * `false` is a sweep that finished with a masa the portal failed to deliver —
   * a whole-year attempt whose file keeps its plain name while the year is one
   * month short. Storing it also makes a snapshot a literal `RunResult`, which
   * is what `runLifecycle.restore` adopts.
   */
  partialSweep: boolean;
  data: Record<string, unknown>[];
  fields: string[];
  filenameHint?: string;
  source: ExportSource;
  sweep: Sweep;
}

/** A snapshot without its stamp: what the rows' own content amounts to. */
export type SweepContent = Omit<SweepSnapshot, "version" | "savedAt">;

/**
 * The resumable part of a result, or null when there is nothing to resume.
 *
 * Two states qualify, and they are the same year in different clothes: a sweep
 * the user STOPPED, and a sweep that FINISHED with a masa the portal failed to
 * deliver. Both are rows plus counts with masa still missing, which is exactly
 * what a resume consumes — the flag only decides whether the file is named
 * `-sebagian`.
 *
 * The test is `isResumable`, not the flag: a whole sweep is not offered for
 * resume because it has nothing pending, and neither is a stop that happened to
 * land after the last masa. A plain scrape has no counts at all.
 */
export function sweepContentOf(result: RunResult | null): SweepContent | null {
  if (!result) return null;
  if (!result.sweep) return null;
  if (!isResumable(result.sweep)) return null;
  if (result.data.length === 0) return null;
  if (result.fields.length === 0) return null;
  if (!result.source) return null;
  return {
    partialSweep: result.partialSweep === true,
    data: result.data,
    fields: result.fields,
    filenameHint: result.filenameHint,
    source: result.source,
    sweep: result.sweep,
  };
}

/** Give a content blob the stamp it is stored with. */
export function stampSnapshot(
  content: SweepContent,
  savedAt: number,
  version = SWEEP_SNAPSHOT_VERSION,
): SweepSnapshot {
  return { version, savedAt, ...content };
}

/** The content half of a snapshot, for comparing two writes. */
export function contentOfSnapshot(snapshot: SweepSnapshot): SweepContent {
  return {
    partialSweep: snapshot.partialSweep,
    data: snapshot.data,
    fields: snapshot.fields,
    filenameHint: snapshot.filenameHint,
    source: snapshot.source,
    sweep: snapshot.sweep,
  };
}

/**
 * Whether a stored sweep belongs to the page asking for it.
 *
 * The safe answer is no: a page whose source cannot be named gets nothing, and a
 * snapshot from another grid is not this grid's half-year. The resume's own
 * guards would also refuse most mismatches (a different grid has different
 * period codes), but this one refuses before the offer is made at all.
 */
export function snapshotAppliesTo(
  snapshot: Pick<SweepSnapshot, "source">,
  page: ExportSource | null,
): boolean {
  return page !== null && snapshot.source === page;
}

// ── Validation ─────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isCount(value: unknown): value is PeriodCount {
  if (!isRecord(value)) return false;
  if (typeof value.period !== "string") return false;
  if (typeof value.rows !== "number" || !Number.isFinite(value.rows)) return false;
  return value.error === undefined || typeof value.error === "string";
}

function isSweep(value: unknown): value is Sweep {
  if (!isRecord(value)) return false;
  if (!isStringArray(value.plan)) return false;
  if (!Array.isArray(value.counts) || !value.counts.every(isCount)) return false;
  if (typeof value.totalRows !== "number" || !Number.isFinite(value.totalRows)) return false;
  return true;
}

/**
 * Read a stored value as a snapshot, or null.
 *
 * Every rejection is silent — the storage is read once at boot, and a blob that
 * fails this guard is dropped rather than repaired. The age check is the one
 * decision with a consequence for the user: an expired snapshot is not offered,
 * so the menu entry starts a fresh year instead of resuming into stale months.
 */
export function readSnapshot(raw: unknown, now: number): SweepSnapshot | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== SWEEP_SNAPSHOT_VERSION) return null;

  const savedAt = raw.savedAt;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  if (savedAt < now - SWEEP_SNAPSHOT_MAX_AGE_MS) return null;

  if (!Array.isArray(raw.data) || !raw.data.every(isRecord)) return null;
  if (!isStringArray(raw.fields)) return null;
  if (typeof raw.source !== "string") return null;
  if (typeof raw.partialSweep !== "boolean") return null;
  if (raw.filenameHint !== undefined && typeof raw.filenameHint !== "string") return null;
  if (!isSweep(raw.sweep)) return null;
  // Nothing pending is nothing to resume. Storing one is refused, so a blob that
  // has one was written by something else (or by a stop that landed after the
  // last masa) and is dropped rather than offered.
  if (!isResumable(raw.sweep)) return null;

  return {
    version: SWEEP_SNAPSHOT_VERSION,
    savedAt,
    partialSweep: raw.partialSweep,
    data: raw.data as Record<string, unknown>[],
    fields: raw.fields,
    filenameHint: raw.filenameHint as string | undefined,
    source: raw.source as ExportSource,
    sweep: raw.sweep,
  };
}

// ── Store ──────────────────────────────────────────────

/** The three storage operations a snapshot needs, injected so tests can stub. */
export interface SweepSnapshotStoreDeps {
  read: () => Promise<unknown>;
  write: (snapshot: SweepSnapshot) => Promise<void>;
  remove: () => Promise<void>;
  now?: () => number;
}

export interface SweepSnapshotStore {
  /** The stored half-sweep, or null. Never throws. */
  load(): Promise<SweepSnapshot | null>;
  /**
   * Store (or clear) the resumable part of `result`, fire-and-forget.
   *
   * Called on every change the life-cycle announces, so it must be cheap when
   * nothing changed: the serialized content is compared with the last write and
   * an identical one is skipped. `savedAt` is only stamped on a real write, so
   * the dedupe cannot be defeated by the clock.
   */
  save(result: RunResult | null): void;
}

export function createSweepSnapshotStore(deps: SweepSnapshotStoreDeps): SweepSnapshotStore {
  const now = deps.now ?? (() => Date.now());
  // The content last written, as a string; null when the store is known empty,
  // and `undefined` while that is still unknown (so the first save always acts).
  let lastContent: string | null | undefined = undefined;
  // The same content by REFERENCE, checked first: the life-cycle hands back the
  // very same row array and counts object until they change, so the announcement
  // every begin and stop makes costs no serialization at all — which matters
  // when a kept half-year is tens of megabytes.
  let lastParts: readonly unknown[] | null | undefined = undefined;

  function sameParts(parts: readonly unknown[]): boolean {
    return (
      lastParts !== null &&
      lastParts !== undefined &&
      lastParts.length === parts.length &&
      parts.every((part, index) => part === lastParts?.[index])
    );
  }

  function contentParts(content: SweepContent): readonly unknown[] {
    return [
      content.data,
      content.fields,
      content.filenameHint,
      content.source,
      content.sweep,
      // The flag is a fact about these rows, so a stop and a finished sweep that
      // share counts are still two different snapshots.
      content.partialSweep,
    ];
  }

  /** Remove what is stored, leaving the memo alone. */
  function removeStored(): void {
    void Promise.resolve()
      .then(() => deps.remove())
      .catch((err: unknown) => debugError("Gagal menghapus simpanan ekspor sebagian", err));
  }

  /** Forget the stored half-sweep and the memo of what was written. */
  function clear(): void {
    lastContent = null;
    lastParts = null;
    removeStored();
  }

  async function load(): Promise<SweepSnapshot | null> {
    let raw: unknown;
    try {
      raw = await deps.read();
    } catch (err) {
      debugError("Gagal membaca simpanan ekspor sebagian", err);
      return null;
    }

    const snapshot = readSnapshot(raw, now());
    if (!snapshot) {
      lastContent = null;
      lastParts = null;
      // Drop what failed the guard (expired, older version, corrupted) instead of
      // leaving it in storage to be re-read on every page load.
      if (raw !== undefined && raw !== null) clear();
      return null;
    }

    const content = contentOfSnapshot(snapshot);
    lastContent = JSON.stringify(content);
    lastParts = contentParts(content);
    return snapshot;
  }

  function save(result: RunResult | null): void {
    const content = sweepContentOf(result);
    if (!content) {
      if (lastParts !== null) clear();
      return;
    }

    // Reference equality first, content equality second: the second catches a
    // snapshot's content rebuilt identically (a merge that changed nothing), the
    // first catches the much more common "nothing happened to the rows".
    const parts = contentParts(content);
    if (sameParts(parts)) return;
    const serialized = JSON.stringify(content);
    if (serialized === lastContent) {
      lastParts = parts;
      return;
    }
    lastContent = serialized;
    lastParts = parts;

    if (serialized.length > SWEEP_SNAPSHOT_MAX_CHARS) {
      // Not truncated on purpose: a short snapshot would make the resumed file
      // short in a way its own counts deny. The reload simply has nothing to
      // offer, which is what it had before this module existed.
      debugWarn(
        `Ekspor sebagian terlalu besar untuk disimpan (${serialized.length} karakter); melanjutkan setelah muat ulang tidak tersedia.`,
      );
      // The serialized content stays memoized (`lastContent`/`lastParts`): it is
      // expensive to build, it will not fit on the next stop either, and the rows
      // themselves still work for the rest of THIS page.
      removeStored();
      return;
    }

    const snapshot = stampSnapshot(content, now());
    void Promise.resolve()
      .then(() => deps.write(snapshot))
      .catch((err: unknown) => debugError("Gagal menyimpan ekspor sebagian", err));
  }

  return { load, save };
}

// ── Module singleton ───────────────────────────────────
// Production uses this (wired in main.ts). Tests build an independent store.

export const sweepSnapshotStore: SweepSnapshotStore = createSweepSnapshotStore({
  read: async () => {
    const stored = await browserAPI.storage.local.get(SWEEP_SNAPSHOT_STORAGE_KEY);
    return (stored as Record<string, unknown> | undefined)?.[SWEEP_SNAPSHOT_STORAGE_KEY];
  },
  write: (snapshot) => browserAPI.storage.local.set({ [SWEEP_SNAPSHOT_STORAGE_KEY]: snapshot }),
  remove: () => browserAPI.storage.local.remove(SWEEP_SNAPSHOT_STORAGE_KEY),
});
