// ============================================================
// SCRAPE-RESULT-TRANSFER.TS — how a big result crosses the bridge
// ============================================================
// `SCRAPE_COMPLETE` carried every collected row in one structured
// clone. A year of a busy grid is tens of thousands of rows, and the
// clone of that much data is a single long synchronous block on the
// page's own main thread — the one thread the portal's Angular app
// is rendering on, during the export the user is watching.
//
// A result below the threshold below is sent exactly as it always
// was, in the completion itself. Above it, the rows go out as
// SCRAPE_DATA_CHUNK messages and the completion names how many must
// arrive. postMessage between one sender and one receiver preserves
// order, so the receiving side assembles by index rather than by
// arrival — and the count is what lets it notice a chunk that never
// turned up instead of exporting a quietly short file.
//
// This module is the MAIN-world half: it splits and it sends. The
// isolated-world half, which reassembles, is result-chunks.ts.
// ============================================================

import type { ScrapeComplete, ScrapeMessage } from "./scraper-types";

/**
 * Rows per chunk. Big enough that the fixed per-message cost is
 * negligible, small enough that no single clone is long enough to be
 * felt. A year of a large grid is a few dozen messages at this size.
 */
export const SCRAPE_CHUNK_ROWS = 2_000;

/** One message's worth of rows, and where they belong in the whole. */
export interface ScrapeDataChunk {
  type: "SCRAPE_DATA_CHUNK";
  /** 0-based position in the transfer. */
  index: number;
  /** How many chunks the whole transfer is. */
  chunks: number;
  rows: Record<string, unknown>[];
}

/**
 * Split rows into fixed-size chunks. A result at or below the
 * threshold comes back as a single chunk, so a caller can treat the
 * two cases the same way.
 */
export function chunkRows(
  rows: Record<string, unknown>[],
  size: number = SCRAPE_CHUNK_ROWS,
): ScrapeDataChunk[] {
  const chunks: ScrapeDataChunk[] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push({
      type: "SCRAPE_DATA_CHUNK",
      index: chunks.length,
      // Fixed up after the loop: the count is part of every chunk, and
      // it is only knowable once the last one exists.
      chunks: 0,
      rows: rows.slice(index, index + size),
    });
  }
  return chunks.map((chunk) => ({ ...chunk, chunks: chunks.length }));
}

/**
 * Whether a result is big enough to be worth splitting. Empty results
 * never are: an empty chunk would be a message that carries nothing and
 * still has to be counted, and a scrape that found nothing has nothing
 * to hand over slowly.
 */
export function shouldChunk(
  rows: Record<string, unknown>[],
  size: number = SCRAPE_CHUNK_ROWS,
): boolean {
  return rows.length > size;
}

/**
 * Send a completion, splitting its rows across chunk messages first
 * when the result is large.
 *
 * `completion.data` is replaced by an empty array in the chunked case
 * so that a receiving side which predates chunking — or a bug that
 * drops a chunk — sees an obviously empty result rather than a
 * plausible-looking partial one. `dataChunks` is the flag the
 * receiver keys off; absent means "the rows are in `data`", which is
 * every run below the threshold and every existing message.
 */
export function sendScrapeComplete(
  send: (message: ScrapeMessage) => void,
  completion: ScrapeComplete,
): void {
  if (!shouldChunk(completion.data)) {
    send(completion);
    return;
  }

  const chunks = chunkRows(completion.data);
  for (const chunk of chunks) send(chunk);
  send({ ...completion, data: [], dataChunks: chunks.length });
}