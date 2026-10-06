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
  /**
   * The rows. Empty when `dataChunks` is set: a large result travels as
   * SCRAPE_DATA_CHUNK messages and the completion only names the count, so
   * a receiver that lost a chunk sees an obviously empty result instead of
   * a plausible-looking partial one. See scrape-result-transfer.ts.
   */
  data: Record<string, unknown>[];
  /**
   * How many SCRAPE_DATA_CHUNK messages must have arrived before this
   * completion. Absent means the rows are in `data` — which is every run
   * below the chunk threshold and every message sent before chunking
   * existed, so an older receiver keeps working unchanged.
   */
  dataChunks?: number;
  fields: string[];
  total: number;
  pages: number;
  elapsed: string;
  filenameHint?: string;
  source: ExportSource;
  /** Incomplete results must not trigger pending exports or comparisons. */
  partial?: boolean;
  /** Reserved for explicitly reported cancellation; actions currently emit no completion on stop. */
  cancelled?: boolean;
  /**
   * The server reported MORE matching rows than the scrape collected.
   *
   * This is the fingerprint of a silent truncation: the portal capped its
   * page size below what we asked for, so the first short page looked like
   * the end of the data. The result is still handed over -- a partial export
   * beats none -- but the panel says so instead of an unqualified success.
   */
  truncated?: boolean;
  /**
   * The largest matching-row count the server claimed during the run, when it
   * claimed one. Carried alongside `truncated` so the notice can name the
   * number the portal itself gave instead of gesturing at "some rows".
   */
  expectedTotal?: number;
  /** Invoice numbers whose targeted lookup exhausted all retries. */
  failedInvoices?: string[];
  /**
   * Names of the individual rows whose download failed, in run order. A bare
   * count ("4 gagal") is not actionable across a 300-file run, so the producer
   * names each one — via describePdfItem(), the same label the progress line
   * used while the run was in flight. Absent means the producer does not name
   * them: a data scrape downloads nothing per row.
   */
  failedItems?: string[];
  failureCount?: number; // exhausted invoice lookups or failed PDF downloads
  /**
   * What produced this completion. A bulk PDF run and a data scrape both end in
   * SCRAPE_COMPLETE with the same shape, so the content script needs this to
   * label its "selesai" notification — the counts alone cannot tell them apart.
   * Absent means a data scrape (the behaviour before this field existed).
   */
  kind?: "scrape" | "pdf";
}

/**
 * One slice of a large result, sent before the completion that names how
 * many slices to expect. Ordering is the receiver's problem: postMessage
 * between one pair preserves order, but the receiver indexes by `index`
 * anyway rather than trusting arrival.
 */
export interface ScrapeDataChunkMessage {
  type: "SCRAPE_DATA_CHUNK";
  /** 0-based position in the transfer. */
  index: number;
  /** How many chunks the whole transfer is. */
  chunks: number;
  rows: Record<string, unknown>[];
}

export interface ScrapeError {
  type: "SCRAPE_ERROR";
  message: string;
}

export type ScrapeMessage = (
  | ScrapeProgress
  | ScrapeComplete
  | ScrapeDataChunkMessage
  | ScrapeError
  | { type: "INJECTED_READY" }
  /**
   * A reference prefix search came back empty and the search stops there (see
   * reference-search.ts and ADR-0012). Not a scrape: the content script only
   * reports the miss in the panel; the portal grid keeps the empty result.
   */
  | { type: "REFERENCE_SEARCH_NOT_FOUND"; value: unknown }
) & {
  /** Correlation only; not authentication. Native downloads/readiness are unscoped. */
  runId?: number;
};

/** Messages the isolated world sends INTO the scraper (direction FROM_CONTENT). */
export type FromContentMessage = (
  /**
   * `skipPdf` asks for the grid rows only. It matters on withholding pages,
   * where the same scrape normally ends by bulk-downloading every slip's PDF;
   * an XLSX/CSV export wants the rows without that download.
   */
  | { type: "START_SCRAPE"; skipPdf?: boolean }
  | { type: "STOP_SCRAPE" }
  | { type: "RESET_SCRAPER" }
  | { type: "START_PDF_DOWNLOAD"; data: Record<string, unknown>[] }
  | { type: "SCRAPE_BY_INVOICES"; invoiceNumbers: string[] }
  /**
   * `matchMode` is optional so the popup's No. Faktur path and the older
   * callers keep the previous behaviour (`contains` for strings, `equals` for
   * arrays). The reference search sends `startswith` — see reference-search.ts.
   */
  | { type: "SET_SERVER_FILTER"; field: string; value: unknown; matchMode?: string }
  | { type: "CLEAR_FILTERS"; fields: string[] }) & { runId?: number };

// Extend XHR for intercepted properties
export interface InterceptedXHR extends XMLHttpRequest {
  __url?: string;
  __method?: string;
  __headers?: Record<string, string>;
  /** Set to true on XHR instances created by the extension's own bulk
   *  download path (xhrDownloadEfakturPdf / xhrDownloadWithholdingPdf).
   *  The native-download XHR interceptor (scraper-xhr-patches.ts) checks this
   *  flag so it doesn't double-fire DOWNLOAD_PDF_ITEM for extension-owned XHRs. */
  __isCindiehBulk?: boolean;
  /** Set by prepareNativeDownloadXhr (scraper-pdf.ts) at send() time when
   *  this XHR is a NATIVE invoice download: the open()-time response
   *  listener stays inert until this flag exists. */
  __downloadArmed?: boolean;
  /** The raw request body stashed by prepareNativeDownloadXhr for row
   *  resolution when the download response arrives. */
  __downloadBody?: string;
}
