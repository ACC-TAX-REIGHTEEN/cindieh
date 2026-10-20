// ============================================================
// GRID-REQUEST.TS — the shape of a Coretax grid request's body
// ============================================================
// Every grid request the portal sends carries its filters in one array:
//
//   { Filters: [ { PropertyName, Value, MatchMode, CaseSensitive, AsString } ],
//     First, Rows, SortField, SortOrder, ... }
//
// Four modules used to read that shape and two used to write it, each with its
// own tolerance for the spelling: one read `Filters` and one read `Filters ||
// filters`; one matched a filter by `PropertyName` and one by `PropertyName ||
// propertyName`; one wrote a filter entry and one wrote the same entry again.
//
// The two READERS also disagreed about the answer that matters. The sweep's
// SCOPE finds the tax period by its MEASURED name (`TaxInvoicePeriod`), while
// the FILE's NAME found it by a HINT — the first filter whose lowercased name
// CONTAINS "period" or "masa". A body carrying `TaxInvoicePeriodStatus` before
// `TaxInvoicePeriod` therefore named the file after one filter while the rows
// came from another. That is the name-hint door ADR-0019 closed for the scope,
// still open for the name.
//
// So the shape lives here, once, and the answer is a NAME:
//
//   - the filter list is read tolerantly (`Filters` or `filters`), and an
//     entry tolerantly (`PropertyName` or `propertyName`, `Value` or `value`);
//   - a filter is written in ONE canonical shape, and a body is written back
//     under the KEY it was read from — a body that spells it `filters` must not
//     be answered with `Filters`, because the portal would then read a body
//     whose period it never received;
//   - a filter is found by its WHOLE name, never by a substring.
//
// The last one is the load-bearing rule. An exact name that this module does
// not know fails SAFE: the hint finds nothing and the file takes its period
// from the rows it holds. A name that merely RESEMBLES a known one fails
// UNSAFE — it names the file after a filter the rows never came from. So the
// names are a table of whole names (`GRID_FILTER_NAMES`), and a grid's
// MEASURED name is checked against it rather than being a second, parallel
// answer.
//
// Pure on purpose: no DOM, no browser API, so every rule here is unit tested
// rather than discovered on a portal.
// ============================================================

/** One entry of the portal's `Filters` array, in the spelling the portal sends. */
export interface GridFilter {
  PropertyName?: string;
  /** The lower-cased spelling, which a body has been observed to carry too. */
  propertyName?: string;
  Value?: unknown;
  /** The lower-cased spelling, which a body has been observed to carry too. */
  value?: unknown;
  MatchMode?: string;
  CaseSensitive?: boolean;
  AsString?: boolean;
  /** "OR" on every entry of a multi-value filter but the first. */
  LogicalOperator?: string;
}

/** A grid request's body, as the portal sends it. */
export type GridBody = Record<string, unknown>;

/** The key a body carries its filter list under. */
export type FiltersKey = "Filters" | "filters";

// ── Reading ───────────────────────────────────────────

/**
 * The body of a grid request, or null when it cannot be read.
 *
 * Never throws: a body that will not parse is a request this module has
 * nothing to say about, and every reader's answer to that is "no filters",
 * not an exception the caller has to catch. The null is kept — rather than an
 * empty body — because "a body I could not read" and "a body with nothing in
 * it" are answered differently when a filter is written into it.
 */
export function parseGridBody(rawBody: string): GridBody | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as GridBody) : null;
  } catch {
    return null;
  }
}

/**
 * The key THIS body carries its filters under.
 *
 * "Filters" is the standard spelling, and the one the portal's own bodies
 * carry. A body that spells it the other way is answered in ITS spelling,
 * because the portal reads the key it sent — a filter written under the key
 * the portal did not send is a filter the portal never receives, which for a
 * period means the same month requested twelve times.
 *
 * The key follows the LIST: a body that holds its filters under one spelling
 * is answered under that one. A body that carries no list at all is answered
 * with the spelling it NAMES, and a body that could not be read is answered
 * with the standard spelling — there is nothing else to go on.
 */
export function filtersKeyOf(body: GridBody | null): FiltersKey {
  if (!body) return "Filters";
  if (Array.isArray(body.Filters)) return "Filters";
  if (Array.isArray(body.filters)) return "filters";
  return "Filters" in body ? "Filters" : "filters";
}

/**
 * The body's filter list, or an empty list when it carries none.
 *
 * Tolerant of the key's spelling, because the portal has been observed to send
 * both and a body that parses is a body whose filters are worth reading. A body
 * that holds its list under the other spelling still has it read — reading and
 * writing are two questions, and only the writing one is about the key.
 */
export function filtersOf(body: GridBody | null): GridFilter[] {
  if (!body) return [];
  if (Array.isArray(body.Filters)) return body.Filters as GridFilter[];
  if (Array.isArray(body.filters)) return body.filters as GridFilter[];
  return [];
}

/** The filter's name, as the portal sent it — empty when it has none. */
export function filterName(filter: GridFilter | undefined): string {
  const name = filter?.PropertyName ?? filter?.propertyName;
  return typeof name === "string" ? name : "";
}

/** The filter's value, as the portal sent it. */
export function filterRawValue(filter: GridFilter | undefined): unknown {
  return filter?.Value ?? filter?.value;
}

/** The filter's value as a trimmed string — "" when it carries none. */
export function filterValue(filter: GridFilter | undefined): string {
  const value = filterRawValue(filter);
  return value === undefined || value === null ? "" : String(value).trim();
}

/**
 * The filter with that WHOLE name, or undefined.
 *
 * The name is matched in full, in any case. A name that merely CONTAINS the
 * one asked for is a different filter — `TaxInvoicePeriodStatus` is not
 * `TaxInvoicePeriod` — and treating it as one is how a file ends up named
 * after a filter its rows never came from.
 */
export function findFilter(
  filters: readonly GridFilter[],
  name: string,
): GridFilter | undefined {
  const wanted = name.toLowerCase();
  return filters.find((filter) => filterName(filter).toLowerCase() === wanted);
}

/**
 * The value of the first of these names the filters carry.
 *
 * The NAMES decide the order, not the body: a list is a priority, so a grid
 * that carries both a specific name and a general one takes the specific one.
 * A name no filter carries is simply not found.
 */
export function filterValueOf(
  filters: readonly GridFilter[],
  names: readonly string[],
): string {
  for (const name of names) {
    const filter = findFilter(filters, name);
    if (filter) {
      const value = filterValue(filter);
      if (value) return value;
    }
  }
  return "";
}

// ── Writing ───────────────────────────────────────────

/**
 * One filter entry, in the shape the portal sends.
 *
 * The one place an entry is built: the extension's own filters and the
 * targeted invoice lookup write the same shape today, and two copies of a
 * shape are two places a rename has to reach.
 */
export function filterEntry(
  name: string,
  value: unknown,
  matchMode = "equals",
): GridFilter {
  return {
    PropertyName: name,
    Value: value,
    MatchMode: matchMode,
    CaseSensitive: false,
    AsString: false,
  };
}

// ── The names ─────────────────────────────────────────

/**
 * The filter names a grid's tax period, month and year live in.
 *
 * These are WHOLE names, matched exactly (see `findFilter`). The list is the
 * priority: the first name a body carries wins.
 *
 * `TaxInvoicePeriod` and `TaxInvoiceYear` are the names read off the live
 * portal for PPN Keluaran (ADR-0019) — the measured grid's own row, and the
 * names the year-wide export's scope uses. The rest are the spellings the
 * other grids' own requests are known to carry, and they are here for the
 * FILE's name only: a grid with no measured row has no scope either (the
 * year-wide export refuses it), so nothing for a name to disagree with.
 *
 * A name missing from this table is not a failure: the file falls back to the
 * period its own rows carry, which is the safer answer anyway.
 */
export const GRID_FILTER_NAMES = {
  /** The filter carrying the tax period. */
  period: ["TaxInvoicePeriod", "MasaPajak", "Masa", "Period"],
  /** The filter carrying the month, where a grid splits the period. */
  month: ["TaxInvoiceMonth", "Bulan", "Month"],
  /** The filter carrying the tax year. */
  year: ["TaxInvoiceYear", "Tahun", "Year"],
} as const;
