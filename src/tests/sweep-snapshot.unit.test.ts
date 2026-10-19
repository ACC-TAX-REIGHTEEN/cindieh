import { describe, expect, it, vi } from "vitest";
import type { RunResult } from "../content/run-lifecycle";
import type { PeriodSummary } from "../content/scrape-batch";
import {
  SWEEP_SNAPSHOT_MAX_AGE_MS,
  SWEEP_SNAPSHOT_MAX_CHARS,
  SWEEP_SNAPSHOT_VERSION,
  contentOfSnapshot,
  createSweepSnapshotStore,
  readSnapshot,
  snapshotAppliesTo,
  stampSnapshot,
  sweepContentOf,
  type SweepContent,
  type SweepSnapshot,
} from "../content/sweep-snapshot";

// A sweep's rows with masa still missing are the only thing about a Run worth
// surviving the page (ADR-0023), and there are two of those: a stop's kept half
// and a sweep that finished with a masa the portal failed to deliver. Two
// properties matter, and they are what these tests are: what may be stored is a
// sweep with a pending masa (never a whole year, never a pending request), and a
// stored blob is only offered back when it is still valid AND still belongs to
// the grid asking for it.

const NOW = Date.UTC(2026, 9, 17, 9, 0, 0);

function summary(overrides: Partial<PeriodSummary> = {}): PeriodSummary {
  return {
    counts: [
      { period: "TD.00701", rows: 3 },
      { period: "TD.00702", rows: 0 },
      { period: "TD.00703", rows: 0, error: "Gagal" },
    ],
    totalRows: 3,
    planned: 12,
    emptyPeriods: ["TD.00702"],
    failedPeriods: ["TD.00703"],
    ...overrides,
  };
}

function stoppedSweep(overrides: Partial<RunResult> = {}): RunResult {
  return {
    data: [{ RecordId: "1" }, { RecordId: "2" }, { RecordId: "3" }],
    fields: ["RecordId"],
    filenameHint: "2026",
    source: "OUTPUT_TAX",
    partialSweep: true,
    sweep: summary(),
    ...overrides,
  };
}

/**
 * The same short year, but the sweep ran to its plan: one masa failed to arrive,
 * so nothing was stopped and the file keeps its plain name — the retry is still
 * owed, which is what makes these rows worth keeping.
 */
function finishedSweep(overrides: Partial<RunResult> = {}): RunResult {
  return stoppedSweep({ partialSweep: false, ...overrides });
}

/** Twelve finished masa: a whole year, so nothing is pending. */
function wholeSweep(): PeriodSummary {
  return {
    counts: Array.from({ length: 12 }, (_, i) => ({
      period: `TD.007${String(i + 1).padStart(2, "0")}`,
      rows: 1,
    })),
    totalRows: 12,
    planned: 12,
    emptyPeriods: [],
    failedPeriods: [],
  };
}

function content(overrides: Partial<RunResult> = {}): SweepContent {
  const built = sweepContentOf(stoppedSweep(overrides));
  if (!built) throw new Error("fixture is not resumable");
  return built;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function makeStore(initial?: unknown) {
  const raw = initial;
  const writes: SweepSnapshot[] = [];
  const read = vi.fn(async (): Promise<unknown> => raw);
  const write = vi.fn(async (snapshot: SweepSnapshot) => {
    writes.push(snapshot);
  });
  const remove = vi.fn(async () => {});
  const store = createSweepSnapshotStore({ read, write, remove, now: () => NOW });
  return { store, read, write, remove, writes };
}

// ── What may be stored ─────────────────────────────────

describe("sweepContentOf", () => {
  it("carries the rows and the counts of a stopped sweep", () => {
    expect(content()).toEqual({
      // Stored rather than implied: a whole sweep carries counts too, so the flag
      // is what says these rows are a half-year.
      partialSweep: true,
      data: [{ RecordId: "1" }, { RecordId: "2" }, { RecordId: "3" }],
      fields: ["RecordId"],
      filenameHint: "2026",
      source: "OUTPUT_TAX",
      sweep: summary(),
    });
  });

  it("carries a finished sweep whose year the portal shorted a masa", () => {
    // Not a stop, and stored anyway: the sweep ran to its plan, one masa failed
    // to arrive, and the retry of that masa is exactly what a resume does.
    expect(sweepContentOf(finishedSweep())).toMatchObject({
      partialSweep: false,
      data: [{ RecordId: "1" }, { RecordId: "2" }, { RecordId: "3" }],
      fields: ["RecordId"],
      filenameHint: "2026",
      source: "OUTPUT_TAX",
      sweep: summary(),
    });
  });

  it("refuses a result with no masa left to resume", () => {
    expect(sweepContentOf(null)).toBeNull();
    // A whole year is not resumable WHICHEVER way its rows ended: there is no
    // pending masa, so storing it would let a later click "resume" a sweep that
    // is already complete.
    expect(sweepContentOf(stoppedSweep({ sweep: wholeSweep() }))).toBeNull();
    expect(sweepContentOf(finishedSweep({ sweep: wholeSweep() }))).toBeNull();
    // No counts, no way to know what is missing.
    expect(sweepContentOf(stoppedSweep({ sweep: undefined }))).toBeNull();
  });

  it("refuses rows that could not make a file", () => {
    expect(sweepContentOf(stoppedSweep({ data: [] }))).toBeNull();
    expect(sweepContentOf(stoppedSweep({ fields: [] }))).toBeNull();
  });

  it("refuses a sweep whose grid is unknown", () => {
    // The grid is the one thing a reload cannot reconstruct from the rows, so a
    // snapshot without it could never be offered back safely.
    expect(sweepContentOf(stoppedSweep({ source: undefined }))).toBeNull();
  });
});

// ── Reading it back ────────────────────────────────────

describe("readSnapshot", () => {
  it("round-trips what stampSnapshot wrote", () => {
    const written = stampSnapshot(content(), NOW);
    expect(readSnapshot(written, NOW)).toEqual(written);
  });

  it("accepts a finished sweep whose year still owes a masa", () => {
    const body = sweepContentOf(finishedSweep());
    if (!body) throw new Error("fixture is not resumable");
    const written = stampSnapshot(body, NOW);

    expect(written.partialSweep).toBe(false);
    expect(readSnapshot(written, NOW)).toEqual(written);
  });

  it("keeps accepting a snapshot written by a clock that ran ahead", () => {
    // A machine whose clock moved backwards must not drop a sweep it just saved.
    const written = stampSnapshot(content(), NOW + 60_000);
    expect(readSnapshot(written, NOW)).not.toBeNull();
  });

  it("drops a snapshot past its window", () => {
    const written = stampSnapshot(content(), NOW - SWEEP_SNAPSHOT_MAX_AGE_MS - 1);
    expect(readSnapshot(written, NOW)).toBeNull();
    expect(readSnapshot(stampSnapshot(content(), NOW - SWEEP_SNAPSHOT_MAX_AGE_MS), NOW)).not.toBeNull();
  });

  it("drops a snapshot from another version rather than migrating it", () => {
    const written = stampSnapshot(content(), NOW, SWEEP_SNAPSHOT_VERSION + 1);
    expect(readSnapshot(written, NOW)).toBeNull();
  });

  it.each([
    ["not an object", "snapshot"],
    ["no version", { savedAt: NOW, ...content() }],
    ["no stamp", { version: SWEEP_SNAPSHOT_VERSION, ...content() }],
    ["rows that are not objects", { ...stampSnapshot(content(), NOW), data: ["row"] }],
    ["fields that are not strings", { ...stampSnapshot(content(), NOW), fields: [1] }],
    ["no source", { ...stampSnapshot(content(), NOW), source: undefined }],
    ["a partial flag that is not a boolean", { ...stampSnapshot(content(), NOW), partialSweep: "true" }],
    [
      "a snapshot with no masa left to resume",
      { ...stampSnapshot(content(), NOW), sweep: wholeSweep() },
    ],
    ["a filename hint that is not text", { ...stampSnapshot(content(), NOW), filenameHint: 2026 }],
    ["counts that are not a summary", { ...stampSnapshot(content(), NOW), sweep: { counts: [] } }],
    [
      "a count with no period",
      {
        ...stampSnapshot(content(), NOW),
        sweep: { ...summary(), counts: [{ rows: 1 }] },
      },
    ],
    [
      "a count with a non-numeric row count",
      {
        ...stampSnapshot(content(), NOW),
        sweep: { ...summary(), counts: [{ period: "TD.00701", rows: "3" }] },
      },
    ],
    [
      "a count with a non-text error",
      {
        ...stampSnapshot(content(), NOW),
        sweep: { ...summary(), counts: [{ period: "TD.00701", rows: 0, error: 1 }] },
      },
    ],
    [
      "period lists that are not arrays of text",
      { ...stampSnapshot(content(), NOW), sweep: { ...summary(), failedPeriods: [1] } },
    ],
    [
      "no planned count",
      {
        ...stampSnapshot(content(), NOW),
        sweep: { counts: [], totalRows: 0, emptyPeriods: [], failedPeriods: [] },
      },
    ],
  ])("refuses %s", (_label, raw) => {
    expect(readSnapshot(raw, NOW)).toBeNull();
  });
});

describe("snapshotAppliesTo", () => {
  const snapshot = stampSnapshot(content(), NOW);

  it("offers a sweep to the grid it came from", () => {
    expect(snapshotAppliesTo(snapshot, "OUTPUT_TAX")).toBe(true);
  });

  it("withholds it from another grid and from a page it cannot name", () => {
    expect(snapshotAppliesTo(snapshot, "INPUT_TAX")).toBe(false);
    expect(snapshotAppliesTo(snapshot, null)).toBe(false);
  });
});

describe("contentOfSnapshot", () => {
  it("is the content that was stamped, without the stamp", () => {
    const body = content();
    expect(contentOfSnapshot(stampSnapshot(body, NOW))).toEqual(body);
  });

  it("keeps the flag a finished sweep was stored with", () => {
    const body = sweepContentOf(finishedSweep());
    if (!body) throw new Error("fixture is not resumable");
    expect(contentOfSnapshot(stampSnapshot(body, NOW)).partialSweep).toBe(false);
  });
});

// ── Storing it ─────────────────────────────────────────

describe("createSweepSnapshotStore", () => {
  it("writes a stamped snapshot for a stopped sweep", async () => {
    const { store, write } = makeStore();

    store.save(stoppedSweep());
    await flush();

    expect(write).toHaveBeenCalledTimes(1);
    const written = write.mock.calls[0]?.[0];
    expect(written).toMatchObject({
      version: SWEEP_SNAPSHOT_VERSION,
      savedAt: NOW,
      source: "OUTPUT_TAX",
      sweep: summary(),
    });
    expect(written.data).toHaveLength(3);
  });

  it("writes a snapshot for a sweep that finished with a failed masa too", async () => {
    const { store, write } = makeStore();

    store.save(finishedSweep());
    await flush();

    expect(write).toHaveBeenCalledTimes(1);
    const written = write.mock.calls[0]?.[0];
    expect(written).toMatchObject({
      version: SWEEP_SNAPSHOT_VERSION,
      savedAt: NOW,
      partialSweep: false,
      source: "OUTPUT_TAX",
      sweep: summary(),
    });
    expect(written.data).toHaveLength(3);
  });

  it("rewrites the same rows when only the flag moved", async () => {
    // A stop and a finished sweep that share counts are still two different
    // snapshots: the flag decides the name a later export carries.
    const { store, write } = makeStore();

    store.save(stoppedSweep());
    store.save(finishedSweep());
    await flush();

    expect(write).toHaveBeenCalledTimes(2);
  });

  it("stores nothing for a run with no masa pending, and clears what was there", async () => {
    const { store, write, remove } = makeStore();

    store.save(stoppedSweep());
    store.save(null);
    await flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite identical content, however often it is announced", async () => {
    const { store, write } = makeStore();

    store.save(stoppedSweep());
    store.save(stoppedSweep());
    store.save(stoppedSweep());
    await flush();

    // Every stop and every begin announces; the same half-year must not be
    // re-serialized and re-written each time.
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("serializes a kept half-year only when it changed", async () => {
    // The life-cycle announces on every begin and stop, and hands back the SAME
    // row array until it changes. Re-serializing tens of megabytes on each click
    // is what the reference check exists to prevent.
    const { store } = makeStore();
    const kept = stoppedSweep();
    const stringify = vi.spyOn(JSON, "stringify");

    store.save(kept);
    const afterFirst = stringify.mock.calls.length;
    store.save(kept);

    expect(stringify.mock.calls.length).toBe(afterFirst);
    stringify.mockRestore();
    await flush();
  });

  it("writes again when the counts move", async () => {
    const { store, write } = makeStore();

    store.save(stoppedSweep());
    store.save(
      stoppedSweep({
        sweep: summary({ counts: [{ period: "TD.00701", rows: 3 }, { period: "TD.00702", rows: 4 }] }),
      }),
    );
    await flush();

    expect(write).toHaveBeenCalledTimes(2);
  });

  it("does not clear on a first save of nothing when it never knew what was stored", async () => {
    // `undefined` is "unknown", not "empty": the first announcement must act, so
    // that a snapshot left by an older version is removed even if it was never
    // read this session.
    const { store, remove } = makeStore();

    store.save(null);
    await flush();

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("stores nothing at all when the sweep is too large, rather than storing a short one", async () => {
    const { store, write, remove } = makeStore();
    const huge = stoppedSweep({
      data: [{ RecordId: "1", Notes: "x".repeat(SWEEP_SNAPSHOT_MAX_CHARS) }],
    });

    store.save(huge);
    await flush();

    expect(write).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("loads a stored snapshot and leaves it alone if nothing changed", async () => {
    const written = stampSnapshot(content(), NOW);
    const { store, write } = makeStore(written);

    expect(await store.load()).toEqual(written);

    store.save(stoppedSweep());
    await flush();

    expect(write).not.toHaveBeenCalled();
  });

  it("reports null and drops what failed the guard", async () => {
    const expired = stampSnapshot(content(), NOW - SWEEP_SNAPSHOT_MAX_AGE_MS - 1);
    const { store, remove } = makeStore(expired);

    expect(await store.load()).toBeNull();
    await flush();

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("reports null when nothing is stored, without touching storage", async () => {
    const { store, remove } = makeStore(undefined);

    expect(await store.load()).toBeNull();
    await flush();

    expect(remove).not.toHaveBeenCalled();
  });

  it("reports null rather than throwing when the read refuses", async () => {
    const read = vi.fn(async () => {
      throw new Error("storage refused");
    });
    const store = createSweepSnapshotStore({ read, write: vi.fn(), remove: vi.fn(), now: () => NOW });

    await expect(store.load()).resolves.toBeNull();
  });

  it("reports nothing when a write refuses, and keeps the page working", async () => {
    const write = vi.fn(async () => {
      throw new Error("quota exceeded");
    });
    const store = createSweepSnapshotStore({ write, read: vi.fn(), remove: vi.fn(), now: () => NOW });

    // The save is fire-and-forget, so a rejection must not reach the caller.
    expect(() => store.save(stoppedSweep())).not.toThrow();
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
  });
});
