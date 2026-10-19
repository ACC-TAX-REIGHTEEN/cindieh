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

/**
 * Extract a masa pajak period in MM/YYYY or MM-YYYY form from free text
 * (e.g. "Periode Masa Pajak 04-2026" → "04-2026").
 * Returns empty string when no match is found.
 */
export function extractMasaPajak(text: string): string {
  if (!text) return "";
  const match = text.match(/(\d{2}[-/]\d{4})/);
  return match ? match[1] : "";
}

/**
 * One masa value, in whatever shape it arrived, as the `MMYYYY` label a
 * filename uses.
 *
 * The shapes are the portal's own: the internal `YYYY_MM`, a `YYYYMM` or
 * `MMYYYY` suffix once non-digits are stripped (`TD007-2026-04`, `042026`),
 * and — when the value is not a period at all — the value with its punctuation
 * removed. That last one is a shape, not a promise: an article code on a PPh 21
 * lampiran is not a period, and is still the best name the file has; the
 * caller recognises it by length rather than trusting it to be a date.
 *
 * `extractMonth`/`extractYear` answer "which month/year is this?"; this
 * answers "what does this period look like in a filename?", which is why both
 * exist instead of one being rebuilt here.
 */
export function formatPeriod(raw: unknown): string {
  const p = String(raw ?? "");

  // 1. Internal format YYYY_MM — the shape extractPeriods below produces.
  if (p.includes("_")) {
    const parts = p.split("_");
    if (parts.length === 2 && parts[0].length === 4 && parts[1].length === 2) {
      return `${parts[1]}${parts[0]}`; // MMYYYY
    }
  }

  // 2. Clear non-digits to handle cases like TD007-2026-04 -> 007202604
  const digits = p.replace(/\D/g, "");

  // 3. Try to find YYYYMM (6 digits) at the end or as a standalone
  const yyyymmMatch = digits.match(/(\d{4})(\d{2})$/);
  if (yyyymmMatch) {
    const y = parseInt(yyyymmMatch[1]);
    const m = parseInt(yyyymmMatch[2]);
    if (y > 1900 && y < 2100 && m >= 1 && m <= 12) {
      return `${yyyymmMatch[2]}${yyyymmMatch[1]}`; // MMYYYY
    }
  }

  // 4. Try to find MMYYYY (6 digits)
  const mmyyyyMatch = digits.match(/(\d{2})(\d{4})$/);
  if (mmyyyyMatch) {
    const y = parseInt(mmyyyyMatch[2]);
    const m = parseInt(mmyyyyMatch[1]);
    if (y > 1900 && y < 2100 && m >= 1 && m <= 12) {
      return digits.slice(-6);
    }
  }

  return p.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Every distinct masa a set of rows carries, sorted, as `YYYY_MM`.
 *
 * The row is read in the portal's own order: the dedicated year/month fields
 * first, then a consolidated `TaxPeriod` (`YYYYMM` or `TD007-YYYY-MM`), then —
 * last resort — the source's own date columns, named by the caller
 * (`dateFields`). Which date a row falls back to is an EXPORT-SOURCE decision
 * (`spec.filename.periodDateFields`), not a fact about dates, which is why the
 * list is a parameter and the ladder lives here.
 */
export function extractPeriods(
  rows: readonly Record<string, unknown>[] | undefined,
  dateFields: readonly string[],
): string[] {
  const found = new Set<string>();
  if (!rows) return [];

  for (const row of rows) {
    let y = "";
    let m = "";

    // Priority 1: Specific Tax Period fields (common names in Coretax JSON)
    const rawY = row["TaxInvoiceYear"] || row["TaxPeriodYear"] || row["TaxYear"] || row["Year"];
    const rawM = row["TaxInvoicePeriod"] || row["TaxPeriodMonth"] || row["TaxPeriod"] || row["Month"];

    if (rawY && rawM) {
      y = extractYear(rawY);
      m = extractMonth(rawM).padStart(2, "0");
    }
    // Priority 2: Consolidated TaxPeriod (usually YYYYMM or TD007-YYYY-MM)
    else if (row["TaxPeriod"]) {
      const sP = String(row["TaxPeriod"]);
      y = extractYear(sP);
      m = extractMonth(sP).padStart(2, "0");
    }
    // Fallback: Date fields (last resort — only if no period fields found).
    else {
      const dateField = dateFields.map((field) => row[field]).find((value) => Boolean(value));
      const ymd = extractYMD(dateField);
      if (ymd) {
        y = ymd.year;
        m = ymd.month;
      }
    }

    if (y && m && y.length === 4 && m.length === 2) {
      found.add(`${y}_${m}`); // YYYY_MM
    }
  }
  return Array.from(found).sort();
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

/** A `YYYY-MM-DD` immediately followed by the time component. */
const ISO_DATE_TIME_PREFIX = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Reformat a value ONLY if it is an ISO datetime — "2026-01-31T23:00:00+07:00"
 * — and otherwise return it untouched.
 *
 * This is narrower than `formatDate`, and deliberately so: a column whose whole
 * job is to catch an ISO timestamp that arrived in a field nobody declared must
 * leave a plain calendar date ("2026-03-04") alone, because that is a different
 * kind of value and the grid's own label already says which one it is. Calling
 * `formatDate` on it would silently turn it into "04/03/2026".
 *
 * It lives here rather than in the caller for ADR-0004's reason: this is a date
 * shape test, and the export column declarations should not hand-roll date
 * regexes.
 */
export function formatIsoDateTime(value: unknown): unknown {
  if (typeof value === "string" && ISO_DATE_TIME_PREFIX.test(value)) return formatDate(value);
  return value;
}

/**
 * Get current year and month formatted as { year: YYYY, month: MM } in Asia/Jakarta (WIB, UTC+7).
 * Timezone-safe: independent of the browser local system timezone offset.
 */
export function getCurrentYearMonthWIB(nowDate: Date = new Date()): { year: string; month: string } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(nowDate);
  let year = "";
  let month = "";
  for (const p of parts) {
    if (p.type === "year") year = p.value;
    if (p.type === "month") month = p.value;
  }
  return { year, month };
}
