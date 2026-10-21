// ============================================================
// SCRAPE-BATCH.TS — the Grid request a sweep is made of
// ============================================================
// A year-wide export is the same scrape twelve times over, once per
// `TaxInvoicePeriod`, and the thing that makes it a feature rather
// than twelve exports is that it stays ONE Run: the rows land in one
// dedupe set, one completion, one file.
//
// This module is the REQUEST half of that: it reads the portal's own grid
// request, measures the filters it carries, derives the period codes the
// sweep may ask for, and rewrites the body for one masa at a time. What a
// sweep IS — its plan and the counts it gathered — belongs to sweep.ts, which
// is where the plan is carried instead of reconstructed.
//
// Measured on the live portal (2026-10-06) rather than assumed:
//
// - The period is a request-body filter. `TaxInvoicePeriod` goes in
//   `body.Filters` with MatchMode "equals" and its value is a code of
//   the form `TD.007MM` — a fixed three-digit prefix plus a two-digit
//   month. `TD.00708` is August. `TaxInvoiceYear` is a SEPARATE
//   filter, so a period and a year are two edits, not one.
// - The server honours `Rows` up to at least 5000, so nothing here
//   depends on a page-size assumption.
// - 44,237 rows across three periods produced ZERO duplicates, and
//   every row carried `RecordId` — so the O(1) dedupe key applies and
//   `stableStringify` never runs.
// - `Payload.TotalRecords` is NOT a row count: it answers every page
//   size with `Rows + 1`. See scraper-xhr.ts. Nothing below trusts it.
//
// Measured again on PPN Masukan (2026-10-21), where the SAME filter names
// carry a different VALUE shape (ADR-0043):
//
// - `TaxInvoicePeriod` arrives as a LIST of codes (`["TD.00709"]`) with
//   MatchMode "contains", not as one string with "equals". A reader that
//   understood only the string form saw no period at all on this grid.
// - The server honours ONE code written back as a plain string: three
//   consecutive months re-requested that way came back with 334, 274 and
//   142 rows, and every row's own period field equalled the code asked
//   for. So the LIST is what the portal sends and the STRING is what it
//   reads — the two are not the same request.
// - `Rows` is honoured here too (10 and 100 came back exactly), and one
//   month held 235 rows — under the 500 asked for, so a short page ends
//   that month and no data is cut.
//
// Pure on purpose: no DOM, no browser API, so every rule here is unit
// tested rather than discovered on a portal.
//
// The sweep is offered on every e-Faktur PPN grid (Keluaran, Masukan, both
// Retur), but a grid may only sweep once its filter NAMES have been read off
// the portal and written into MEASURED_SWEEP_FILTERS. PPN Keluaran and PPN
// Masukan have a row; the two Retur grids are REFUSED — deliberately: a name
// hint plus a value in the right shape was enough to find a filter, and not
// enough to know the endpoint honours it. A sweep that guesses produces a file
// of months the user cannot trust, which is worse than a feature that says it
// is not ready.
//
// The refusal is still the measurement. `readSweepFilters` reports the grid's
// measured row (or its absence) and every filter the request carries, and
// scraper-actions logs that line before the guard can refuse, so a refused grid
// hands over the spellings to record. See ADR-0018/ADR-0019 and
// tools/README.md (the per-grid table).
// ============================================================

import type { ExportSource } from "./page-context";
import {
  findFilter,
  filterName,
  filterRawValue,
  filterValue,
  filtersKeyOf,
  filtersOf,
  parseGridBody,
  type GridFilter,
} from "./grid-request";

/**
 * One grid's sweep filters, as MEASURED off the live portal.
 *
 * The names are the portal's own, read from a captured request. Nothing else is
 * accepted on their behalf — not a similar-sounding name, and not a value shape
 * on its own — because a wrong guess here issues twelve requests for months
 * nobody confirmed the endpoint honours.
 */
export interface SweepFilterMeasurement {
  /** `body.Filters[].PropertyName` that selects the tax period. */
  period: string;
  /** `body.Filters[].PropertyName` that selects the tax year. */
  year: string;
}

/**
 * The measured sweep filters, one row per grid that has been measured.
 *
 * PPN Keluaran (2026-10-06) and PPN Masukan (2026-10-21) are the measured
 * grids: `TaxInvoicePeriod` carries the `TD.007MM` code and `TaxInvoiceYear`
 * the four-digit year — the same two NAMES on both, though Masukan carries the
 * period as a list of codes (ADR-0043). The two Retur grids have no row, so
 * `measuredSweepFilters` answers null and the sweep is refused there rather
 * than run on a lookalike. A grid joins this table when its request has been
 * read off the portal and the row recorded in tools/README.md and ADR-0019 — a
 * code change with a measurement behind it, never a runtime inference.
 */
export const MEASURED_SWEEP_FILTERS: Partial<Record<ExportSource, SweepFilterMeasurement>> = {
  OUTPUT_TAX: { period: "TaxInvoicePeriod", year: "TaxInvoiceYear" },
  INPUT_TAX: { period: "TaxInvoicePeriod", year: "TaxInvoiceYear" },
};

/** The measurement for a grid, or null when the grid has never been measured. */
export function measuredSweepFilters(
  source: ExportSource | null | undefined,
): SweepFilterMeasurement | null {
  if (!source) return null;
  return MEASURED_SWEEP_FILTERS[source] ?? null;
}

/**
 * How many months a batch request asks for, or undefined when it is not a batch.
 *
 * A message crosses a world boundary and nothing guarantees a sane number: zero
 * would sweep nothing and report an empty year, a negative or absurd one would
 * either throw mid-run or hammer the portal. Anything that is not a whole number
 * from 1 to 12 is not a batch, so it degrades to the ordinary single-period
 * scrape rather than into a bad run.
 */
export function batchMonthCount(requested: unknown): number | undefined {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return undefined;
  const months = Math.trunc(requested);
  return months >= 1 && months <= 12 ? months : undefined;
}

/** A four-digit tax year — the only year shape this module accepts. */
const YEAR_SHAPE = /^(20|19)\d{2}$/;

/**
 * Index of the filter that selects the tax period, or -1.
 *
 * Found by its MEASURED name and nothing else: the exact string the portal was
 * observed to send for this grid. `MatchMode`, `CaseSensitive` and every other
 * filter are carried through untouched by `overridesForPeriod`.
 */
function periodFilterIndex(filters: GridFilter[], measurement: SweepFilterMeasurement): number {
  return filters.findIndex((f) => filterName(f).toLowerCase() === measurement.period.toLowerCase());
}

/**
 * The period codes a period filter carries, in the order the portal sent them.
 *
 * A period filter is not always ONE code. PPN Masukan's request carries the
 * selected months as a LIST (`["TD.00709"]`) — one element when one month is
 * selected, several when the user selected several — while PPN Keluaran's
 * carries a single string. A reader that understood only the string form saw
 * no period at all on Masukan, and the sweep then degenerated into "whatever
 * the grid is already filtered to" (ADR-0043).
 */
function periodCodesOf(filter: GridFilter | undefined): string[] {
  const value = filterRawValue(filter);
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

/**
 * The ONE code the sweep plans from, or null when the filter carries none.
 *
 * The first code is the plan's source, and the first code is what the sweep
 * writes back. A capture may hold several (the user selected several months):
 * every code of one grid shares the prefix, so the first is enough to derive
 * the twelve codes — and the sweep replaces the whole filter with one code at
 * a time anyway. A filter that carries none is a filter the sweep cannot read.
 */
function periodCodeOf(filter: GridFilter | undefined): string | null {
  return periodCodesOf(filter)[0] ?? null;
}

/**
 * The year the request pins, or null when it does not carry the measured filter.
 *
 * Returns the side even when its VALUE is unreadable, so a reading can report
 * what the request actually said. `capturedYear` is the one that judges the
 * shape; keeping the two apart is what lets a log line report `year=` with a
 * value the guard will refuse.
 */
function yearSide(
  filters: GridFilter[],
  measurement: SweepFilterMeasurement,
): SweepFilterSide | null {
  const filter = findFilter(filters, measurement.year);
  return filter ? { name: measurement.year, value: filterValue(filter) } : null;
}

/**
 * The fixed part of a period code, or null when the value is not one.
 *
 * `TD.00708` yields `TD.007`, leaving `08` as the part that moves. Only the
 * PORTAL's own value may be used as the source: a prefix invented locally
 * would produce twelve period values the portal has never heard of, and every
 * one of them would come back empty.
 *
 * ONE code, never several. A value carrying a separator is a LIST that has not
 * been read as one, and a prefix derived from it produces twelve codes the
 * portal has never heard of ("TD.00709,TD.00701" → the prefix "TD.00709,TD.007"
 * → twelve requests that all come back empty). Fail SAFE: no prefix at all, so
 * the guard refuses instead of sweeping months that do not exist.
 */
export function periodPrefix(periodValue: string): string | null {
  const text = String(periodValue ?? "").trim();
  if (/[,;|\s]/.test(text)) return null;
  const match = text.match(/^(.*\d{3})(0[1-9]|1[0-2])$/);
  return match ? match[1] : null;
}

/** One period code from a prefix and a 1-based month. */
export function periodCode(prefix: string, month: number): string {
  return `${prefix}${String(month).padStart(2, "0")}`;
}

/**
 * The period codes for a run, oldest month first.
 *
 * Derived from the value the captured request already carries, so the codes are
 * the portal's own. Returns an empty list when the captured value is not a
 * period code, because the alternative — guessing — returns twelve empty
 * periods and reads as "this taxpayer has no data".
 */
export function planPeriods(periodValue: string, count = 12): string[] {
  const prefix = periodPrefix(periodValue);
  if (!prefix) return [];
  const months = Math.max(0, Math.min(12, Math.trunc(count)));
  return Array.from({ length: months }, (_, i) => periodCode(prefix, i + 1));
}

/**
 * The period codes a resume message asks for, or undefined when it asks for none.
 *
 * The same guard as `batchMonthCount`, for the same reason: the value crossed a
 * world boundary and nothing vouches for it. A code that is not in the measured
 * period shape is dropped here, and scraper-actions then narrows what survives
 * against the portal's own year plan — this is the shape check, that is the
 * scope check.
 */
export function resumePeriodCodes(requested: unknown): string[] | undefined {
  if (!Array.isArray(requested)) return undefined;
  const codes = requested.filter(
    (value): value is string => typeof value === "string" && periodPrefix(value) !== null,
  );
  return codes.length > 0 ? [...new Set(codes)] : undefined;
}

/**
 * Body overrides that re-request the grid for one period.
 *
 * `Filters` is replaced wholesale because the portal's body merge is shallow:
 * overriding one nested entry is not expressible, so the array is rebuilt with
 * only the measured period filter's `Value` changed. MatchMode, CaseSensitive
 * and every other filter — `TaxInvoiceStatus` and the taxpayer identifiers
 * among them — are carried through untouched.
 *
 * The rewritten value is ONE CODE as a plain string, whatever the captured
 * filter held: PPN Masukan's request arrives with the selected months as a
 * LIST (`["TD.00709"]`, MatchMode "contains"), and the portal was measured
 * honouring exactly this write — one code, as a string, with its own
 * MatchMode kept (ADR-0043). The list is what the portal sends; the string is
 * what it reads.
 *
 * Throws when the captured body has no measured period filter: a batch
 * silently requested without one would scrape the SAME period twelve times and
 * report twelve periods' worth of one month's rows. An unmeasured grid gets the
 * same throw, because it has no period filter this module is allowed to trust.
 */
export function overridesForPeriod(
  capturedRawBody: string,
  period: string,
  first: number,
  rows: number,
  source: ExportSource | null | undefined,
): Record<string, unknown> {
  const body = parseGridBody(capturedRawBody);
  const filters = filtersOf(body);
  const measurement = measuredSweepFilters(source);
  const index = measurement ? periodFilterIndex(filters, measurement) : -1;
  if (!measurement || index < 0) {
    throw new Error(
      `Request tidak punya filter ${measurement?.period ?? "masa"} — batch masa tidak bisa dijalankan.`,
    );
  }
  const next = filters.map((f, i) => (i === index ? { ...f, Value: period } : { ...f }));
  // Written back under the key the body was read from: a body that spells it
  // `filters` must not be answered with `Filters`, because the portal would
  // then read a body whose period filter it never received.
  return { [filtersKeyOf(body)]: next, First: first, Rows: rows };
}

/** The period the captured request is currently filtered to, or null. */
export function capturedPeriod(
  capturedRawBody: string,
  source: ExportSource | null | undefined,
): string | null {
  const filters = filtersOf(parseGridBody(capturedRawBody));
  const measurement = measuredSweepFilters(source);
  if (!measurement) return null;
  const index = periodFilterIndex(filters, measurement);
  if (index < 0) return null;
  return periodCodeOf(filters[index]);
}

/**
 * The year the captured request is filtered to, or null.
 *
 * A batch sweeps every month of ONE year, so its filename has to name the year.
 * The grid's own period hint would otherwise produce a file named for a single
 * month -- a January export that quietly holds twelve -- which is the one name a
 * filing would never be checked against.
 *
 * An unmeasured grid has no year to read, because the table is what says where
 * that grid keeps it; null there is the same absence as a measured request that
 * does not carry the filter.
 */
export function capturedYear(
  capturedRawBody: string,
  source: ExportSource | null | undefined,
): string | null {
  const filters = filtersOf(parseGridBody(capturedRawBody));
  const measurement = measuredSweepFilters(source);
  if (!measurement) return null;
  const side = yearSide(filters, measurement);
  if (!side) return null;
  const text = side.value.trim();
  return YEAR_SHAPE.test(text) ? text : null;
}

/** One side of a sweep-filter reading: the filter's name and the value it carries. */
export interface SweepFilterSide {
  name: string;
  value: string;
}

/**
 * What a captured request offers a sweep, and what the measured table makes of
 * it.
 *
 * `measurement` is null on a grid that has never been measured — the refusal,
 * reported as a property of the GRID rather than as a request that happens to
 * lack a filter. `seen` lists every filter the request carries, used and passed
 * over alike, because a refusal is still the measurement: the line names the
 * spellings to record in the table (ADR-0019, tools/README.md).
 */
export interface SweepFilterReading {
  measurement: SweepFilterMeasurement | null;
  period: SweepFilterSide | null;
  year: SweepFilterSide | null;
  seen: string[];
}

/**
 * The period side of a reading: the ONE code the sweep would plan from.
 *
 * A filter carrying several codes shows the first one, because that is what
 * the plan is built from and what the sweep writes back. A filter carrying
 * none reads as an empty value, which the wording reports as a value in no
 * known format — the distinction that tells the next run whether to look for
 * a filter or to learn a value shape.
 */
function periodSide(filter: GridFilter | undefined): SweepFilterSide {
  return {
    name: filterName(filter),
    value: periodCodeOf(filter) ?? "",
  };
}

/**
 * Reads what a captured request offers a sweep, without judging it.
 *
 * The reading is the FACT and `describeSweepFilters` is the wording; the split
 * exists so the guard's decision can be logged on a live grid without a test
 * having to assert against an Indonesian log line. Nothing here decides whether
 * a sweep may run — `batchScopeError` does, from the same reading.
 */
export function readSweepFilters(
  capturedRawBody: string,
  source: ExportSource | null | undefined,
): SweepFilterReading {
  const body = parseGridBody(capturedRawBody);
  const filters = filtersOf(body);
  const measurement = measuredSweepFilters(source);
  const periodAt = measurement ? periodFilterIndex(filters, measurement) : -1;
  return {
    measurement,
    period: periodAt >= 0 ? periodSide(filters[periodAt]) : null,
    year: measurement ? yearSide(filters, measurement) : null,
    seen: filters
      .map((filter) => String(filter?.PropertyName ?? ""))
      .filter((name) => name.length > 0),
  };
}

/**
 * One line naming what a captured request offered a sweep — printed by
 * scraper-actions before the guard can refuse, so a refusal arrives with the
 * spelling the table would have to learn and an unmeasured grid says that is
 * what it is.
 */
export function describeSweepFilters(
  capturedRawBody: string,
  source: ExportSource | null | undefined,
): string {
  const reading = readSweepFilters(capturedRawBody, source);
  const seen = reading.seen.length > 0 ? reading.seen.join(", ") : "none";
  if (!reading.measurement) return `grid belum terukur · filters seen: ${seen}`;
  return [
    `period=${describeFilterSide(reading.period, true)}`,
    `year=${describeFilterSide(reading.year, false)}`,
    `filters seen: ${seen}`,
  ].join(" · ");
}

function describeFilterSide(side: SweepFilterSide | null, isPeriod: boolean): string {
  if (!side) return "none";
  // A measured period filter that IS there but reads as no code at all is a grid
  // whose spelling has moved since it was measured: the distinction is what tells
  // the next run whether to look for a filter or to learn a value shape.
  const shape = isPeriod && periodPrefix(side.value) === null ? ", value in no known format" : "";
  return `${side.name}=${side.value}${shape}`;
}

/**
 * A period filter that is present but unreadable on a grid that HAS been
 * measured: its value has left the family `periodPrefix` knows. Distinct from
 * missing, which sends the user hunting for a filter that is already there.
 */
const UNRECOGNISED_PERIOD_MESSAGE =
  "Filter masa pajak di permintaan grid ini belum dikenali Cindieh, jadi ekspor satu tahun belum bisa dijalankan.";

/**
 * The grid has never been measured, so no year-wide export may run here.
 *
 * This is the refusal the name-hint door used to soften into a guess. It is
 * deliberately about the GRID rather than about the request: nothing in a
 * captured body can tell the code what an unmeasured grid calls its filters, and
 * a sweep that proceeds on a lookalike is a file the user cannot trust.
 */
const UNMEASURED_GRID_MESSAGE =
  "Filter masa dan tahun grid ini belum pernah diukur dari portal, jadi ekspor satu tahun belum bisa dijalankan di sini. Gunakan ekspor biasa (Excel, CSV, atau PDF) untuk sementara.";

/**
 * Why a sweep may not run against this captured request, or null when it may.
 *
 * Four things can go wrong, and each has its own fix:
 *
 *  * The grid has no measured row: the feature does not run here at all, and
 *    nothing in this request can change that (ADR-0019).
 *  * A measured grid's request does not carry the measured period filter: the
 *    table is stale, or this is not the request it was written for.
 *  * The period value has left the measured family, so twelve codes cannot be
 *    derived from it.
 *  * No readable year: the period code carries no year of its own (`TD.00708` is
 *    August of whatever year the SEPARATE year filter says), so the sweep would
 *    read that month code across every year the account has — and then write a
 *    file named for a year it never filtered to.
 *
 * Returns the message instead of throwing, so the rule stays pure and testable;
 * scraper-actions turns it into the SCRAPE_ERROR the panel shows.
 */
export function batchScopeError(
  capturedRawBody: string,
  source: ExportSource | null | undefined,
): string | null {
  const measurement = measuredSweepFilters(source);
  if (!measurement) return UNMEASURED_GRID_MESSAGE;

  const filters = filtersOf(parseGridBody(capturedRawBody));
  const periodAt = periodFilterIndex(filters, measurement);
  if (periodAt < 0) {
    return `Permintaan grid ini tidak punya filter ${measurement.period}, jadi ekspor satu tahun tidak bisa dijalankan.`;
  }
  // The period filter is read as the LIST it may be, and the plan is built from
  // the one code it carries: a grid whose filter holds several codes is still
  // one grid, and the sweep replaces the whole filter with one code at a time.
  const periodCode = periodCodeOf(filters[periodAt]);
  if (periodCode === null || periodPrefix(periodCode) === null) {
    return UNRECOGNISED_PERIOD_MESSAGE;
  }
  if (capturedYear(capturedRawBody, source) === null) {
    return `Permintaan grid ini tidak punya filter ${measurement.year} yang bisa dibaca, jadi ekspor satu tahun tidak bisa dijalankan.`;
  }
  return null;
}
