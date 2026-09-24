// ============================================================
// REFERENCE-SEARCH.TS — match mode for the Reference filter
// ============================================================
// The Coretax server prices the Reference filter by MatchMode, not by the
// length of the value. Measured on the live grid (24 Sep 2026, three runs — see
// tools/README.md): `contains` took 96.9 s for one value that `startswith`
// answered in 0.149 s, and a *shorter* value could be the slow one
// ("EE-03" contains = 24.8 s, "EE-030" contains = 0.21 s in the same run).
// `equals` was fast but wrong: a typed reference is usually a prefix of the
// stored one, so it returned zero rows.
//
// So the extension asks for the prefix match — which is what a user typing a
// reference prefix means anyway — and pays for the wide match only when the
// prefix found nothing. Widening the *value* instead of the mode was never an
// option: a "prefix ≤ 6 characters" search still used the slow `contains` mode.
//
// Pure module: no DOM, no window — the decision is testable on its own, and the
// scraper owns the state it reads.

export const REFERENCE_FIELD = "Reference";

/** Prefix match: 0.09–0.30 s at every value length across all three runs. */
export const REFERENCE_FAST_MATCH_MODE = "startswith";

/** Substring match: finds mid-string references, but can take minutes. */
export const REFERENCE_WIDE_MATCH_MODE = "contains";

/**
 * True when a grid request body asked the server for this field and mode.
 *
 * A capture is only evidence about the mode it was sent with: an empty response
 * to a request that carried no (or another) Reference filter says nothing about
 * whether the prefix match was too narrow.
 */
export function bodyRequestsFilter(rawBody: string, field: string, matchMode: string): boolean {
  try {
    const parsed = JSON.parse(rawBody) as {
      Filters?: unknown;
      filters?: unknown;
    } | null;
    const list = parsed?.Filters ?? parsed?.filters;
    if (!Array.isArray(list)) return false;
    return list.some(
      (entry) =>
        (entry as { PropertyName?: unknown } | null)?.PropertyName === field &&
        (entry as { MatchMode?: unknown } | null)?.MatchMode === matchMode,
    );
  } catch {
    // Not a JSON grid body — nothing to read.
    return false;
  }
}

export interface ReferenceWideningInput {
  /** Current filter value for the Reference field. */
  value: unknown;
  /** Current filter mode for the Reference field. */
  matchMode: string;
  /** Rows in the captured response (`Payload.Data.length`). */
  rowCount: number;
  /** Outgoing body of the request whose response was captured. */
  rawBody: string;
  /** True while a scrape run owns the page's requests. */
  runActive: boolean;
}

/**
 * Decide whether an empty grid response should be retried with the wide mode.
 *
 * The filter mode doubles as the one-shot latch: widening flips it to
 * `contains`, and the very next capture then fails the `startswith` check — so
 * a value can be widened at most once per search, with no extra state to reset.
 * A running scrape is excluded because its own per-invoice lookups (`equals`)
 * can legitimately come back empty, and clicking the portal's search button
 * mid-run would fight the run for the grid.
 */
export function shouldWidenReferenceSearch(input: ReferenceWideningInput): boolean {
  if (input.runActive) return false;
  if (input.matchMode !== REFERENCE_FAST_MATCH_MODE) return false;
  if (typeof input.value !== "string" || input.value === "") return false;
  if (input.rowCount > 0) return false;
  return bodyRequestsFilter(input.rawBody, REFERENCE_FIELD, REFERENCE_FAST_MATCH_MODE);
}
