// ── Shared types for scraper.ts ────────────────────
// These types are used by the injected page-context scraper script.

import type { ExportSource } from "./page-context";

export interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
  rawBody: string;
  response: unknown;
  initialData: Record<string, unknown>[];
  initialFirst: number;
  source: ExportSource;
}

export interface ScrapeProgress {
  type: "SCRAPE_PROGRESS";
  total: number;
  page: number;
  elapsed: string;
  status: string;
  currentIndex?: number; // 1-based position in bulk download
  totalCount?: number; // total items in bulk download
  failureCount?: number; // cumulative failures so far
}

export interface ScrapeComplete {
  type: "SCRAPE_COMPLETE";
  data: Record<string, unknown>[];
  fields: string[];
  total: number;
  pages: number;
  elapsed: string;
  filenameHint?: string;
  source: ExportSource;
  failureCount?: number; // total failures in bulk download
}

export interface ScrapeError {
  type: "SCRAPE_ERROR";
  message: string;
}

export type ScrapeMessage = ScrapeProgress | ScrapeComplete | ScrapeError | { type: "INJECTED_READY" };

/** Messages the isolated world sends INTO the scraper (direction FROM_CONTENT). */
export type FromContentMessage =
  | { type: "START_SCRAPE" }
  | { type: "STOP_SCRAPE" }
  | { type: "RESET_SCRAPER" }
  | { type: "START_PDF_DOWNLOAD"; data: Record<string, unknown>[] }
  | { type: "SCRAPE_BY_INVOICES"; invoiceNumbers: string[] }
  | { type: "SET_SERVER_FILTER"; field: string; value: unknown }
  | { type: "CLEAR_FILTERS"; fields: string[] };

// Extend XHR for intercepted properties
export interface InterceptedXHR extends XMLHttpRequest {
  __url?: string;
  __method?: string;
  __headers?: Record<string, string>;
  /** Set to true on XHR instances created by the extension's own bulk
   *  download path (xhrDownloadEfakturPdf / xhrDownloadWithholdingPdf).
   *  The native-download XHR interceptor in scraper.ts checks this flag
   *  so it doesn't double-fire DOWNLOAD_PDF_ITEM for extension-owned XHRs. */
  __isCindiehBulk?: boolean;
}
