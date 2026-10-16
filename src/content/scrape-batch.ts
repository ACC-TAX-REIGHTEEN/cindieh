// ============================================================
// SCRAPE-BATCH.TS — one Run across many tax periods
// ============================================================
// A year-wide export is the same scrape twelve times over, once per
// `TaxInvoicePeriod`, and the thing that makes it a feature rather
// than twelve exports is that it stays ONE Run: the rows land in one
// dedupe set, one completion, one file.
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
// Pure on purpose: no DOM, no browser API, so every rule here is unit
// tested rather than discovered on a portal.
//
// The sweep covers every e-Faktur PPN grid (Keluaran, Masukan, both Retur),
// but only Keluaran's filter NAMES were measured. On the other grids the
// period and year are therefore discovered by a name hint PLUS a value in the
// measured format — two independent signals, because a value alone cannot be
// trusted (an invoice number such as `010.000-26.00000012` also ends in two
// digits that look like a month). A period filter whose value is in no known
// format stops the sweep with a message that says so, which is also the
// feedback that measures the next grid. That feedback is not left to a message:
// `readSweepFilters` reports which door found each filter, `describeSweepFilters`
// words it, and scraper-actions logs the line before the guard can refuse — so a
// run on a still-unmeasured grid hands over the spelling it needs. See
// ADR-0018/ADR-0019 and tools/README.md (the measurement per grid).
// ============================================================

/** The body key the portal's grid requests carry their filters under. */
const FILTERS_KEY = "Filters";

/** The filter property that selects the tax period, as measured on PPN Keluaran. */
export const PERIOD_PROPERTY = "TaxInvoicePeriod";

/** How many rows one period contributed, and whether it fetched cleanly. */
export interface PeriodCount {
  /** The `TD.` code that was requested. */
  period: string;
  /** Rows collected for it, after cross-period dedupe. */
  rows: number;
  /** The message when the period could not be fetched at all. */
  error?: string;
}

/**
 * What a whole batch produced, in the shape the panel reports it.
 *
 * `emptyPeriods` exists because the server's own count is unusable: with
 * nothing trustworthy to compare against, the one anomaly that is detectable
 * is a period that came back empty while its neighbours did not. That is a
 * month that silently vanished, and it has to be said out loud rather than
 * shipped as a short year.
 */
export interface PeriodSummary {
  counts: PeriodCount[];
  /** Total rows across every period. */
  totalRows: number;
  /**
   * How many periods the sweep was ASKED for.
   *
   * Equal to `counts.length` on a finished sweep, and larger on one the user
   * stopped — which is the whole reason it is carried: the panel can then say
   * "10 dari 12 masa" instead of leaving the user to work out how much of the
   * year is missing from a row count alone.
   */
  planned: number;
  /** Periods that returned nothing although others returned something. */
  emptyPeriods: string[];
  /** Periods that failed outright. */
  failedPeriods: string[];
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

/** The filter property that selects the tax year, as measured on PPN Keluaran. */
export const YEAR_PROPERTY = "TaxInvoiceYear";

/**
 * Filter-name hints for the grids whose filter names were never measured.
 *
 * The portal spells the same concepts several ways across its grids — the
 * export columns already carry `TaxInvoicePeriod`/`TaxPeriodMonth`/`TaxPeriod`
 * as candidate PERIOD fields, and page-context reads the INPUT_TAX filename
 * hint from any filter named like period/masa or year/tahun — so the discovery
 * here reuses that convention rather than inventing a second one.
 */
const PERIOD_NAME_HINTS = ["period", "masa"];
const YEAR_NAME_HINTS = ["year", "tahun"];

/**
 * Name hints that point at a DIFFERENT period than the one being swept.
 *
 * PPN Masukan's request may carry the credit period as a second period filter
 * (`PeriodCredit`/`YearCredit` — the spellings export-source.ts already
 * declares for that grid). Sweeping by it would produce twelve coherent months
 * of the WRONG period, so a credit-named filter is never taken for either the
 * period or the year.
 */
const CREDIT_NAME_HINTS = ["credit", "kredit"];

/**
 * Body keys a grid may carry its year under instead of a filter. The retur
 * grids' filename hint (page-context.ts) already reads exactly these three
 * spellings from the same kind of request, so the convention is reused, not
 * invented.
 */
const YEAR_BODY_KEYS = ["TaxYear", "Year", "Tahun"];

/** A four-digit tax year — the only year shape this module accepts. */
const YEAR_SHAPE = /^(20|19)\d{2}$/;

/** One entry of the portal's `body.Filters` array. */
interface GridFilter {
  PropertyName?: string;
  Value?: unknown;
  MatchMode?: string;
  CaseSensitive?: boolean;
}

function parseBody(rawBody: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function filtersOf(body: Record<string, unknown>): GridFilter[] {
  const filters = body[FILTERS_KEY];
  return Array.isArray(filters) ? (filters as GridFilter[]) : [];
}

function filterNameMatches(filter: GridFilter, hints: readonly string[]): boolean {
  const name = String(filter?.PropertyName ?? "").toLowerCase();
  return hints.some((hint) => name.includes(hint));
}

/**
 * Which door found a sweep filter.
 *
 * `measured` is the name read off the live portal; `hint` is the pair of weaker
 * signals an unmeasured grid is reached through — a period/year name AND a
 * value in the measured format. Keeping the door in the reading is what lets a
 * run say which grids still rest on a guess, and it is the thing the portal
 * loop collects when it measures the next grid (ADR-0019).
 */
export type SweepFilterDoor = "measured" | "hint";

/** One filter a sweep would use, and the door that found it. */
interface FoundFilter {
  index: number;
  door: SweepFilterDoor;
}

/** The filter that selects the tax period, and how it was found. */
function findPeriodFilter(filters: GridFilter[]): FoundFilter | null {
  const measured = filters.findIndex((f) => f?.PropertyName === PERIOD_PROPERTY);
  if (measured >= 0) return { index: measured, door: "measured" };
  const hinted = filters.findIndex(
    (f) =>
      filterNameMatches(f, PERIOD_NAME_HINTS) &&
      !filterNameMatches(f, CREDIT_NAME_HINTS) &&
      periodPrefix(String(f?.Value ?? "")) !== null,
  );
  return hinted >= 0 ? { index: hinted, door: "hint" } : null;
}

/** Index of the filter that selects the tax period, or -1. */
function periodFilterIndex(filters: GridFilter[]): number {
  return findPeriodFilter(filters)?.index ?? -1;
}

/** The filter that selects the tax year, and how it was found. */
function findYearFilter(filters: GridFilter[]): FoundFilter | null {
  const measured = filters.findIndex((f) => f?.PropertyName === YEAR_PROPERTY);
  if (measured >= 0) return { index: measured, door: "measured" };
  const hinted = filters.findIndex(
    (f) =>
      filterNameMatches(f, YEAR_NAME_HINTS) &&
      !filterNameMatches(f, CREDIT_NAME_HINTS) &&
      YEAR_SHAPE.test(String(f?.Value ?? "").trim()),
  );
  return hinted >= 0 ? { index: hinted, door: "hint" } : null;
}

/** Index of the filter that selects the tax year, or -1. */
function yearFilterIndex(filters: GridFilter[]): number {
  return findYearFilter(filters)?.index ?? -1;
}

/**
 * The fixed part of a period code, or null when the value is not one.
 *
 * `TD.00708` yields `TD.007`, leaving `08` as the part that moves. Only the
 * PORTAL's own value may be used as the source: a prefix invented locally
 * would produce twelve period values the portal has never heard of, and every
 * one of them would come back empty.
 */
export function periodPrefix(periodValue: string): string | null {
  const match = String(periodValue ?? "").match(/^(.*\d{3})(0[1-9]|1[0-2])$/);
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
 * only the period's `Value` changed. MatchMode, CaseSensitive and every other
 * filter — `TaxInvoiceStatus` and the taxpayer identifiers among them — are
 * carried through untouched.
 *
 * Throws when the captured body has no period filter at all: a batch silently
 * requested without one would scrape the SAME period twelve times and report
 * twelve periods' worth of one month's rows.
 */
export function overridesForPeriod(
  capturedRawBody: string,
  period: string,
  first: number,
  rows: number,
): Record<string, unknown> {
  const body = parseBody(capturedRawBody);
  const filters = filtersOf(body);
  const index = periodFilterIndex(filters);
  if (index < 0) {
    throw new Error(`Request tidak punya filter ${PERIOD_PROPERTY} — batch masa tidak bisa dijalankan.`);
  }
  const next = filters.map((f, i) => (i === index ? { ...f, Value: period } : { ...f }));
  return { [FILTERS_KEY]: next, First: first, Rows: rows };
}

/** The period the captured request is currently filtered to, or null. */
export function capturedPeriod(capturedRawBody: string): string | null {
  const filters = filtersOf(parseBody(capturedRawBody));
  const index = periodFilterIndex(filters);
  const value = index >= 0 ? filters[index]?.Value : undefined;
  return typeof value === "string" ? value : null;
}

/**
 * The body field a request carries its year under instead of a filter.
 *
 * The retur grids may state their year as a body field; the same keys the retur
 * grids' filename hint (page-context.ts) reads. The field is carried through
 * every sweep request untouched, so the year stays pinned either way.
 */
function yearBodySide(body: Record<string, unknown>): SweepFilterSide | null {
  for (const key of YEAR_BODY_KEYS) {
    const text = String(body[key] ?? "").trim();
    if (YEAR_SHAPE.test(text)) return { name: key, value: text, door: "hint" };
  }
  return null;
}

/**
 * The year the captured request is filtered to, or null.
 *
 * A batch sweeps every month of ONE year, so its filename has to name the year.
 * The grid's own period hint would otherwise produce a file named for a single
 * month -- a January export that quietly holds twelve -- which is the one name a
 * filing would never be checked against.
 */
export function capturedYear(capturedRawBody: string): string | null {
  const body = parseBody(capturedRawBody);
  const filters = filtersOf(body);
  const index = yearFilterIndex(filters);
  if (index >= 0) {
    const text = String(filters[index]?.Value ?? "").trim();
    return YEAR_SHAPE.test(text) ? text : null;
  }
  return yearBodySide(body)?.value ?? null;
}

/** One side of a sweep-filter reading: the filter, its value, and the door. */
export interface SweepFilterSide {
  name: string;
  value: string;
  door: SweepFilterDoor;
}

/**
 * What a captured request offers a sweep, and what it merely LOOKS like it
 * offers.
 *
 * `seen` is the load-bearing field on a grid whose filter names were never
 * measured: every filter whose NAME says period or year, used or not, so the
 * line this module prints names the spelling the guard would have to learn
 * rather than leaving the user with "belum dikenali" and no next step. A
 * credit-named filter is listed on purpose — it is exactly the thing that must
 * NOT be swept by, and a reading that hid it would hide the reason a request
 * was refused.
 */
export interface SweepFilterReading {
  period: SweepFilterSide | null;
  year: SweepFilterSide | null;
  seen: string[];
}

function sideOf(filter: GridFilter | undefined, door: SweepFilterDoor): SweepFilterSide {
  return {
    name: String(filter?.PropertyName ?? ""),
    value: String(filter?.Value ?? ""),
    door,
  };
}

/**
 * Reads what a captured request offers a sweep, without judging it.
 *
 * The reading is the FACT and `describeSweepFilters` is the wording; the split
 * exists so the guard's decision can be logged on a live grid without a test
 * having to assert against an Indonesian log line. Nothing here decides whether
 * a sweep may run — `batchScopeError` does, from the same filters.
 */
export function readSweepFilters(capturedRawBody: string): SweepFilterReading {
  const body = parseBody(capturedRawBody);
  const filters = filtersOf(body);
  const period = findPeriodFilter(filters);
  const year = findYearFilter(filters);
  return {
    period: period ? sideOf(filters[period.index], period.door) : null,
    year: year ? sideOf(filters[year.index], year.door) : yearBodySide(body),
    seen: filters
      .filter((f) => filterNameMatches(f, PERIOD_NAME_HINTS) || filterNameMatches(f, YEAR_NAME_HINTS))
      .map((f) => String(f?.PropertyName ?? "")),
  };
}

/**
 * One line naming what a captured request offered a sweep and through which
 * door — printed by scraper-actions before the guard can refuse, so a refusal
 * on an unmeasured grid arrives with the spelling it would have to learn.
 */
export function describeSweepFilters(capturedRawBody: string): string {
  const reading = readSweepFilters(capturedRawBody);
  return [
    `period=${describeFilterSide(reading.period, true)}`,
    `year=${describeFilterSide(reading.year, false)}`,
    `period/year-named filters seen: ${reading.seen.length > 0 ? reading.seen.join(", ") : "none"}`,
  ].join(" · ");
}

function describeFilterSide(side: SweepFilterSide | null, isPeriod: boolean): string {
  if (!side) return "none";
  const door = side.door === "measured" ? "measured name" : "name hint";
  // A period filter that IS there but reads as no code at all is the shape an
  // unmeasured grid has: the distinction is what tells the next run whether to
  // learn a format or look for a filter.
  const shape = isPeriod && periodPrefix(side.value) === null ? ", value in no known format" : "";
  return `${side.name}=${side.value} (${door}${shape})`;
}

/**
 * A period filter that is present but unreadable — the shape an unmeasured
 * grid has until its format is measured. Distinct from "no period filter",
 * which would send the user hunting for a filter that is already there.
 */
const UNRECOGNISED_PERIOD_MESSAGE =
  "Filter masa pajak di permintaan grid ini belum dikenali Cindieh, jadi ekspor satu tahun belum bisa dijalankan.";

/**
 * Why a batch may not run against this captured request, or null when it may.
 *
 * A sweep needs BOTH filters, and each one is the same kind of guard: without
 * them the twelve requests return something that is not a year.
 *
 *  * No period filter: every request re-asks for the period the grid is already
 *    showing, so the file holds one month's rows twelve times.
 *  * A period filter in no known format: the same outcome, one month twelve
 *    times, but the fix is in this module, not in the user's filters.
 *  * No year filter: the period code carries no year of its own (`TD.00708` is
 *    August of whatever year the SEPARATE year filter says), so the sweep reads
 *    that month code across every year the account has — and then writes a file
 *    named for a year it never filtered to.
 *
 * Returns the message instead of throwing, so the rule stays pure and testable;
 * scraper-actions turns it into the SCRAPE_ERROR the panel shows.
 */
export function batchScopeError(capturedRawBody: string): string | null {
  const filters = filtersOf(parseBody(capturedRawBody));
  const periodAt = periodFilterIndex(filters);
  if (periodAt < 0) {
    // A period filter we cannot READ is a different problem from no period
    // filter at all, and it is what an unmeasured grid produces: saying "no
    // filter" would send the user hunting for a filter that is already there.
    return filters.some((f) => filterNameMatches(f, PERIOD_NAME_HINTS))
      ? UNRECOGNISED_PERIOD_MESSAGE
      : "Permintaan grid ini tidak punya filter masa pajak, jadi ekspor satu tahun tidak bisa dijalankan.";
  }
  if (periodPrefix(String(filters[periodAt]?.Value ?? "")) === null) {
    return UNRECOGNISED_PERIOD_MESSAGE;
  }
  if (capturedYear(capturedRawBody) === null) {
    return "Permintaan grid ini tidak punya filter tahun pajak, jadi ekspor satu tahun tidak bisa dijalankan.";
  }
  return null;
}

/**
 * Roll per-period counts into what the panel reports.
 *
 * A period is called empty only when it produced nothing AND at least one other
 * period produced something — a taxpayer genuinely idle for a month is normal,
 * so flagging every zero would train the user to ignore the flag. A period that
 * FAILED is listed separately: that is a transport problem, not a quiet month.
 *
 * `planned` defaults to what the counts themselves say, which is the finished
 * sweep; a stopped sweep passes the count it was asked for so the report can
 * name the gap (scrape-result.ts).
 */
export function summarisePeriods(counts: PeriodCount[], planned = counts.length): PeriodSummary {
  const failedPeriods = counts.filter((c) => c.error).map((c) => c.period);
  const withRows = counts.filter((c) => !c.error && c.rows > 0).map((c) => c.period);
  const emptyPeriods =
    withRows.length > 0
      ? counts.filter((c) => !c.error && c.rows === 0).map((c) => c.period)
      : [];
  return {
    counts,
    totalRows: counts.reduce((sum, c) => sum + c.rows, 0),
    planned,
    emptyPeriods,
    failedPeriods,
  };
}

/**
 * The masa a resumed sweep must still fetch: the year's plan minus the periods
 * that FINISHED.
 *
 * "Finished" means recorded without an error, so the two states a stopped sweep
 * leaves behind are both resumed:
 *
 *  * a period that FAILED has no rows — the year is missing it entirely;
 *  * a period the stop cut short is not recorded at all (ADR-0020 keeps an
 *    interrupted request out of the counts, because "masa tanpa baris" would
 *    tell the reader to go and check a month the sweep never finished asking
 *    for).
 *
 * Returns an empty list when nothing was kept: with no count there is no year to
 * plan from. Callers then have nothing to resume and must start a fresh sweep
 * rather than send an empty list — a sweep asked for no periods would report a
 * finished year without making a single request.
 */
export function pendingPeriods(summary: PeriodSummary): string[] {
  const seed = summary.counts[0]?.period;
  if (!seed) return [];
  const plan = planPeriods(seed, summary.planned);
  const finished = new Set(
    summary.counts.filter((count) => !count.error).map((count) => count.period),
  );
  return plan.filter((code) => !finished.has(code));
}

/**
 * The union of a kept sweep's summary and the one that came back on top of it.
 *
 * A resumed sweep reports only the masa it fetched, so the panel line, the
 * completion notification and the file's own `-sebagian` question must all be
 * answered from the UNION. The incoming counts win for a period they cover
 * again — a resumed retry of a failed masa replaces that failure with the
 * retry's outcome — and `planned` keeps the larger of the two, because a resumed
 * sweep is asked for a subset of the year it belongs to.
 *
 * The empty/failed lists are not merged by hand: `summarisePeriods` is the one
 * place that decides what counts as empty, so the union goes back through it.
 * Counts come out in code order, which is month order for one year.
 */
export function mergePeriodSummaries(
  previous: PeriodSummary,
  incoming: PeriodSummary,
): PeriodSummary {
  const byPeriod = new Map(previous.counts.map((count) => [count.period, count]));
  for (const count of incoming.counts) byPeriod.set(count.period, count);
  const counts = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  return summarisePeriods(counts, Math.max(previous.planned, incoming.planned));
}
