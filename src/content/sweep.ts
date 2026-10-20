// ============================================================
// SWEEP.TS — what a sweep IS: its plan, and what each masa gave
// ============================================================
// A Period sweep (CONTEXT.md) is one Run over a year's tax periods. Two facts
// describe it, and they are different kinds of fact:
//
//   - the PLAN: the period codes the sweep covers. It is what the sweep was
//     ASKED for, and it is known before the first request goes out.
//   - the COUNTS: what each period contributed, as it happened.
//
// Until now the plan was thrown away at the world boundary and RECONSTRUCTED
// from the counts: `pendingPeriods` took the first count as a seed and the
// `planned` number as a length, and rebuilt the plan from the seed's prefix.
// That reconstruction is only right when the first count is month 01 — an
// assumption nothing stated, nothing asserted, and nothing in the resumed half
// of a sweep could hold (a resume's own half starts wherever the resume began,
// so its plan is a SUFFIX of the year's, not the year).
//
// The plan now travels with the counts, so this module can answer the two
// questions every caller was really asking:
//
//   - which masa are still missing?   → `missingPeriods`
//   - is there anything left to resume? → `isResumable`
//
// Both were asked four times, in three modules, with four different guard sets
// — and the "a masa finished" predicate was written out five more times by
// hand. That is what a deep module is for: the decision lives here, once.
//
// The union is what settles (ADR-0023): a resumed sweep reports only the masa
// it fetched, so the panel line, the completion notification and the file's
// `-sebagian` question are all answered from the MERGE of the kept half and
// the half that came back on top of it. `mergeSweeps` is that merge.
//
// Pure on purpose: no DOM, no browser API, so every rule here is unit tested
// rather than discovered on a portal. The shape crosses the world boundary as
// plain data (postMessage) and is stored as plain JSON, so it stays a plain
// data shape — the questions are free functions over it, not methods.
// ============================================================

/** How many rows one masa contributed, and whether it fetched cleanly. */
export interface PeriodCount {
  /** The `TD.` code that was requested. */
  period: string;
  /** Rows collected for it, after cross-period dedupe. */
  rows: number;
  /** The message when the period could not be fetched at all. */
  error?: string;
}

/**
 * A sweep: the period codes it covers, and what each of them contributed.
 *
 * The plan is the half that used to be lost, and it is what makes the counts
 * readable on their own: a count says "August gave 1,204 rows", and only the
 * plan says which months were supposed to be there at all.
 *
 * `totalRows` is the rows the sweep HOLDS, which is not always the sum of the
 * counts: two halves counted by two accumulators can overlap where a failed
 * masa's partial rows were fetched again, so the union's row count is the
 * deduplicated one (ADR-0016) and the caller that knows it says so.
 */
export interface Sweep {
  /** The period codes this sweep covers, oldest first. */
  readonly plan: readonly string[];
  /** What each period contributed. */
  readonly counts: readonly PeriodCount[];
  /** The rows this sweep holds, after dedupe across its periods. */
  readonly totalRows: number;
}

/**
 * Build a sweep from the counts a run recorded and the plan it was given.
 *
 * The plan is taken as given, never derived: the codes come from the request
 * the PORTAL itself made, so a plan this module invented would be months the
 * portal has never heard of.
 *
 * The counts and the plan are held by reference, not copied: a sweep is
 * immutable once built, and the snapshot store compares the very same array to
 * decide whether anything changed — copying would make every announcement
 * serialize a half-year again.
 */
export function sweepOf(
  counts: readonly PeriodCount[],
  plan: readonly string[],
  totalRows?: number,
): Sweep {
  return {
    plan,
    counts,
    totalRows: totalRows ?? counts.reduce((sum, count) => sum + count.rows, 0),
  };
}

/**
 * The masa that finished: recorded, and not an error.
 *
 * A masa that FAILED is not finished, which is why both states a stopped or a
 * failed sweep leaves behind are resumed — the month is still missing.
 */
export function finishedPeriods(sweep: Sweep): string[] {
  return sweep.counts.filter((count) => !count.error).map((count) => count.period);
}

/** The masa that could not be fetched at all. */
export function failedPeriods(sweep: Sweep): string[] {
  return sweep.counts.filter((count) => count.error).map((count) => count.period);
}

/**
 * The masa that came back empty although others came back with something.
 *
 * The server's own count is unusable here (on this endpoint it is not a count
 * at all), so the one anomaly that is detectable is a period that vanished
 * between non-empty neighbours: a month that silently disappeared, which has to
 * be said out loud rather than shipped as a short year. A taxpayer genuinely
 * idle for a month is normal, so a sweep where NOTHING arrived names no empty
 * period at all.
 */
export function emptyPeriods(sweep: Sweep): string[] {
  const withRows = sweep.counts.filter((count) => !count.error && count.rows > 0);
  if (withRows.length === 0) return [];
  return sweep.counts.filter((count) => !count.error && count.rows === 0).map((count) => count.period);
}

/**
 * The masa this sweep still has to fetch: its plan minus the masa that
 * finished.
 *
 * The plan is the whole scope, so a masa the portal failed to deliver is
 * missing again (the retry of a failed month is the same resume), and a masa
 * the user stopped before is missing too.
 */
export function missingPeriods(sweep: Sweep): string[] {
  const finished = new Set(finishedPeriods(sweep));
  return sweep.plan.filter((code) => !finished.has(code));
}

/**
 * Whether this sweep still has a masa to fetch.
 *
 * The one question four callers were asking, each with its own guard set: the
 * life-cycle (may these rows be adopted?), the snapshot (may these rows be
 * stored? may this blob be offered?), and the batch entry (is this a resume or
 * a fresh year?).
 */
export function isResumable(sweep: Sweep): boolean {
  return missingPeriods(sweep).length > 0;
}

/**
 * The union of a kept sweep and the half that came back on top of it.
 *
 * A resumed sweep reports only the masa it fetched, so the panel line, the
 * completion notification and the file's own `-sebagian` question must all be
 * answered from the UNION. The incoming counts win for a period they cover
 * again — a resumed retry of a failed masa replaces that failure with the
 * retry's outcome — and the union's plan is the union of the two plans, so a
 * resumed half that covered a SUFFIX of the year still leaves the whole year
 * on the table.
 *
 * `totalRows` is the caller's to say: the two halves were counted by two
 * independent accumulators, so their counts can overlap where a failed masa
 * had already collected rows the resumed retry fetched again. The panel names
 * what the FILE holds — the deduplicated union (ADR-0016) — not the sum of the
 * counts, and the caller holding the deduplicated rows is the one that knows.
 */
export function mergeSweeps(previous: Sweep, incoming: Sweep, totalRows?: number): Sweep {
  const byPeriod = new Map(previous.counts.map((count) => [count.period, count]));
  for (const count of incoming.counts) byPeriod.set(count.period, count);
  const counts = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  const plan = [...new Set([...previous.plan, ...incoming.plan])].sort((a, b) =>
    a.localeCompare(b),
  );
  return {
    plan,
    counts,
    totalRows: totalRows ?? counts.reduce((sum, count) => sum + count.rows, 0),
  };
}
