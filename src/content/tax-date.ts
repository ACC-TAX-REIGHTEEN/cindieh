// ============================================================
// TAX-DATE.TS — Masa pajak period & date parsing
// ============================================================
// The single home for Coretax date/period parsing, consolidating what
// used to live separately in exporter.ts, page-context.ts,
// downloader.ts, and comparer.ts. Pure functions — no DOM, no browser
// API dependencies.
//
// Timezone rule (from AGENTS.md, pinned by tests): ISO strings carry the
// calendar date already expressed in their stated offset, so we reformat
// the captured digits directly — never round-trip through `Date`, which
// shifts the date near midnight.
// ============================================================

/**
 * Extract a 4-digit year from a raw period value that may contain
 * non-digit prefixes (e.g. "TD007-2026-04" → "2026").
 * Returns empty string when no valid year is found.
 */
export function extractYear(raw: unknown): string {
  if (!raw) return "";
  const s = String(raw).replace(/\D/g, "");
  const match = s.match(/(20\d{2}|19\d{2})/);
  return match ? match[1] : "";
}

/**
 * Extract a 2-digit month from a raw period value that may contain
 * non-digit prefixes (e.g. "TD007-2026-04" → "04", "2026-07" → "07").
 * Supports the Coretax tax-domain period form (`TD00704`), a YYYYMM
 * suffix, an MMYYYY suffix, and a bare month.
 * Returns empty string when no valid month is found.
 */
export function extractMonth(raw: unknown): string {
  if (!raw) return "";
  const rawText = String(raw).trim();
  const taxDomainPeriod = rawText.match(/^TD\.?\d{3}(0[1-9]|1[0-2])$/i);
  if (taxDomainPeriod) return taxDomainPeriod[1];

  const s = rawText.replace(/\D/g, "");
  // Try YYYYMM suffix (last 6 digits)
  const yyyymm = s.match(/(20\d{2}|19\d{2})(0[1-9]|1[0-2])$/);
  if (yyyymm) return yyyymm[2];
  // Try MMYYYY suffix (last 6 digits)
  const mmyyyy = s.match(/(0[1-9]|1[0-2])(20\d{2}|19\d{2})$/);
  if (mmyyyy) return mmyyyy[1];
  // Bare month (e.g. "04" or "4") — only valid when year is provided separately
  const bare = s.match(/^(0?[1-9]|1[0-2])$/);
  if (bare) return bare[1].padStart(2, "0");
  return "";
}

export interface YmdParts {
  year: string;
  month: string;
  day: string;
}

/**
 * Extract the calendar Y-M-D prefix from a date value
 * (e.g. "2026-07-01", "2026-07-01T00:00:00+07:00" → {2026, 07, 01}).
 * Timezone-safe: reads the digits straight from the string, never via
 * `Date`. Returns null when the value has no YYYY-MM-DD prefix.
 */
export function extractYMD(value: unknown): YmdParts | null {
  if (value == null) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { year: m[1], month: m[2], day: m[3] };
}

/**
 * Convert a date value to Indonesian DD/MM/YYYY, timezone-safe.
 * Pure date ("YYYY-MM-DD") and ISO datetime with an explicit offset are
 * reformatted directly from their captured digits; anything else falls
 * back to a best-effort `Date` parse.
 */
export function formatDate(dateStr: unknown): string {
  if (!dateStr || typeof dateStr !== "string") return String(dateStr || "");

  // Fast path: pure date "YYYY-MM-DD" (no time component) — safe from timezone shift.
  const dateOnly = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`; // DD/MM/YYYY
  }

  // ISO datetime with explicit offset (e.g. "2026-01-31T23:00:00+07:00").
  // The calendar date (year, month, day) in the string is ALREADY expressed in
  // the stated timezone offset — we just reformat those captured digits directly.
  // No UTC conversion needed: converting to UTC and back would shift the date
  // whenever the local time is near midnight, causing off-by-one errors.
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:?\d{2}|Z)$/i);
  if (iso) {
    // iso[1]=YYYY, iso[2]=MM, iso[3]=DD — already in the offset's calendar date
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  // Fallback: best-effort parse (may be timezone-dependent).
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  return dateStr;
}
