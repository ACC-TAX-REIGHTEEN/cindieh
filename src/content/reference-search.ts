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
// So the extension always asks for the prefix match — which is what a user
// typing a reference prefix means anyway — and stops there: when the prefix
// match returns nothing, the search is reported as not found instead of being
// retried with the minutes-long wide match (ADR-0012). Widening the *value*
// instead of the mode was never an option: a "prefix ≤ 6 characters" search
// still used the slow `contains` mode.
//
// Pure module: no DOM, no window — the decision is testable on its own, and the
// scraper owns the state it reads.

export const REFERENCE_FIELD = "Reference";

/** Prefix match: 0.09–0.30 s at every value length across all three runs. */
export const REFERENCE_FAST_MATCH_MODE = "startswith";
