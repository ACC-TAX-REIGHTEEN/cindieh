// ============================================================
// COMPLETION-NOTICE.TS — "Selesai" desktop notification hand-off
// ============================================================
// Chrome/Firefox do not expose the notifications API to content scripts, so the
// toast has to be raised by the background worker. The background worker and the
// content script have exactly one channel in common — `storage.local` — which is
// also the seam ADR-0002 settled on for popup → content traffic; this reuses it
// rather than reopening the `runtime.onMessage` channel that decision removed.
//
// The content script publishes a record when a run finishes AND the user has
// asked for notifications; the background watches the same key and raises one
// toast per record. `id` changes on every publish so two identical completions
// still produce two notifications (storage.onChanged only fires on a real
// change), and `at` lets the receiver drop a record left over from an earlier
// browser session.

import { browserAPI } from "./browser-shim";
import { debugError } from "./debug";

export const COMPLETION_STORAGE_KEY = "cindiehLastCompletion";

/** Older than this and the record is a leftover, not a completion to announce. */
export const MAX_NOTIFICATION_AGE_MS = 60_000;

/**
 * What finished. `scrape`/`pdf` are successful-ish runs (a run that comes back
 * short is still one of these when it is accepted; a rejected or failed run is
 * `error`). The kind only picks the toast title, so adding one is cheap.
 */
export type CompletionKind = "scrape" | "pdf" | "error";

/**
 * Storage key for the notification click's "show the panel" command. The click
 * happens in the background worker and the panel lives in the content script,
 * so it rides the same `storage.local` seam every background → tab command uses
 * (ADR-0002): a changed value, a timestamp so two clicks in a row are still a
 * real change, and a tab that is not open simply misses it.
 */
export const SHOW_PANEL_REQUEST_KEY = "cindiehShowPanelRequest";

export interface CompletionRecord {
  /** Unique per publish: makes a repeated completion a real storage change. */
  id: number;
  kind: CompletionKind;
  /** Human summary for the notification body. */
  detail: string;
  /** Epoch ms of the publish. */
  at: number;
  /**
   * Full href of the page the run happened on, when known. A toast click uses
   * it to return to that exact tab and grid instead of any Coretax tab.
   */
  pageUrl?: string;
}

export function buildCompletionRecord(
  kind: CompletionKind,
  detail: string,
  now: number = Date.now(),
  pageUrl?: string,
): CompletionRecord {
  const record: CompletionRecord = { id: now, kind, detail, at: now };
  // Omitted rather than undefined: the background must not mistake a missing
  // page for one it cannot parse.
  if (pageUrl) record.pageUrl = pageUrl;
  return record;
}

/** Validate a stored record. Returns null for anything unrecognizable. */
export function normalizeCompletionRecord(value: unknown): CompletionRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "scrape" && raw.kind !== "pdf" && raw.kind !== "error") return null;
  if (typeof raw.id !== "number" || !Number.isFinite(raw.id)) return null;
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return null;
  const record: CompletionRecord = {
    id: raw.id,
    kind: raw.kind,
    detail: typeof raw.detail === "string" ? raw.detail : "",
    at: raw.at,
  };
  if (typeof raw.pageUrl === "string" && raw.pageUrl) record.pageUrl = raw.pageUrl;
  return record;
}

/** Title and body for the toast, in the project's user-facing language. */
export function formatCompletionNotification(record: CompletionRecord): {
  title: string;
  message: string;
} {
  const title =
    record.kind === "error"
      ? "Proses Cindieh gagal"
      : record.kind === "pdf"
        ? "Unduhan PDF selesai"
        : "Ekspor data selesai";
  // A failed run's fallback must not say it finished: the whole point of the
  // notification is to contradict the assumption that it did.
  const fallback =
    record.kind === "error"
      ? "Proses tidak selesai. Periksa panel Cindieh untuk detailnya."
      : "Proses Cindieh telah selesai.";
  return { title, message: record.detail || fallback };
}

/**
 * A detail string from the completion's own counts, for the toast body.
 *
 * Every count here exists because the toast is read AWAY from the panel: the
 * user is not looking at Cindieh when they need to know the run came back
 * shorter than it looked.
 *
 * - `missing` is the No. Faktur shortfall: numbers the run was asked for that no
 *   row carried. Zero keeps the wording identical to a run with no filter at all.
 * - `failedPeriods`/`emptyPeriods` are the per-period findings of a year-wide
 *   sweep, named the way the panel names them ("masa gagal diambil", "masa tanpa
 *   baris") so the toast sends the user to the words they will read there.
 * - `truncated` is the portal capping its own page size: a partial result the
 *   panel already flags and the toast must not call a clean success.
 *
 * The trailing affirmation is an affirmation, so it is printed only where it is
 * true: a failed period or a truncated result drops it, while a missing number
 * or an empty month (neither of which is a failure) keeps it.
 */
export function describeCompletion(counts: {
  total: number;
  failureCount?: number;
  missing?: number;
  failedPeriods?: number;
  emptyPeriods?: number;
  truncated?: boolean;
}): string {
  const failed = counts.failureCount ?? 0;
  const missing = counts.missing ?? 0;
  const failedPeriods = counts.failedPeriods ?? 0;
  const emptyPeriods = counts.emptyPeriods ?? 0;
  const parts = [`${counts.total} data diproses`];
  if (missing > 0) parts.push(`${missing} nomor faktur tidak ditemukan`);
  if (failedPeriods > 0) parts.push(`${failedPeriods} masa gagal diambil`);
  if (emptyPeriods > 0) parts.push(`${emptyPeriods} masa tanpa baris`);
  if (counts.truncated) parts.push("hasil mungkin belum lengkap");
  if (failed > 0) parts.push(`${failed} gagal`);
  else if (failedPeriods === 0 && !counts.truncated) parts.push("tanpa kegagalan");
  return `${parts.join(", ")}.`;
}

/**
 * Publish a completion record for the background worker to announce. Containment
 * on purpose: a failed write must never disturb the scrape flow that produced it.
 */
export async function publishCompletion(
  kind: CompletionKind,
  detail: string,
  now: number = Date.now(),
  pageUrl?: string,
): Promise<void> {
  try {
    await browserAPI.storage.local.set({
      [COMPLETION_STORAGE_KEY]: buildCompletionRecord(kind, detail, now, pageUrl),
    });
  } catch (err) {
    debugError("Gagal memublikasikan notifikasi selesai", err);
  }
}

// ── Notification click: back to the run's own page ────

const PORTAL_ORIGIN = "https://coretaxdjp.pajak.go.id";

/**
 * A `tabs.query` match pattern for the portal page a run happened on, so a
 * clicked toast can return to that exact grid instead of any Coretax tab. Keeps
 * the origin and the first two path segments (`…/e-invoice-portal/output-tax`,
 * `…/withholding-slips-portal/my-withholding-slips`): SPA state and query
 * strings move around, the section does not. Null for anything that is not a
 * portal page, which sends the click to the any-portal-tab fallback.
 */
export function notificationTabPattern(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (url.origin !== PORTAL_ORIGIN) return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    return `${PORTAL_ORIGIN}/${segments.slice(0, 2).join("/")}*`;
  } catch {
    return null;
  }
}

/** Ask every open portal tab to bring its Cindieh panel forward. */
export async function requestShowPanel(now: number = Date.now()): Promise<void> {
  try {
    await browserAPI.storage.local.set({ [SHOW_PANEL_REQUEST_KEY]: now });
  } catch (err) {
    debugError("Gagal meminta panel Cindieh ditampilkan", err);
  }
}
