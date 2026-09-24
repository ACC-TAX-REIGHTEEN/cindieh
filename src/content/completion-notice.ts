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

export type CompletionKind = "scrape" | "pdf";

export interface CompletionRecord {
  /** Unique per publish: makes a repeated completion a real storage change. */
  id: number;
  kind: CompletionKind;
  /** Human summary for the notification body. */
  detail: string;
  /** Epoch ms of the publish. */
  at: number;
}

export function buildCompletionRecord(
  kind: CompletionKind,
  detail: string,
  now: number = Date.now(),
): CompletionRecord {
  return { id: now, kind, detail, at: now };
}

/** Validate a stored record. Returns null for anything unrecognizable. */
export function normalizeCompletionRecord(value: unknown): CompletionRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "scrape" && raw.kind !== "pdf") return null;
  if (typeof raw.id !== "number" || !Number.isFinite(raw.id)) return null;
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return null;
  return {
    id: raw.id,
    kind: raw.kind,
    detail: typeof raw.detail === "string" ? raw.detail : "",
    at: raw.at,
  };
}

/** Title and body for the toast, in the project's user-facing language. */
export function formatCompletionNotification(record: CompletionRecord): {
  title: string;
  message: string;
} {
  const title = record.kind === "pdf" ? "Unduhan PDF selesai" : "Ekspor data selesai";
  return { title, message: record.detail || "Proses Cindieh telah selesai." };
}

/** A detail string from the completion's own counts, for the toast body. */
export function describeCompletion(counts: {
  total: number;
  failureCount?: number;
}): string {
  const failed = counts.failureCount ?? 0;
  const base = `${counts.total} data diproses`;
  return failed > 0 ? `${base}, ${failed} gagal.` : `${base}, tanpa kegagalan.`;
}

/**
 * Publish a completion record for the background worker to announce. Containment
 * on purpose: a failed write must never disturb the scrape flow that produced it.
 */
export async function publishCompletion(
  kind: CompletionKind,
  detail: string,
  now: number = Date.now(),
): Promise<void> {
  try {
    await browserAPI.storage.local.set({
      [COMPLETION_STORAGE_KEY]: buildCompletionRecord(kind, detail, now),
    });
  } catch (err) {
    debugError("Gagal memublikasikan notifikasi selesai", err);
  }
}
