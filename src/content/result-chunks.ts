// ============================================================
// RESULT-CHUNKS.TS — the isolated-world half of a chunked transfer
// ============================================================
// The other half is scrape-result-transfer.ts, in the MAIN world.
// A large scrape result arrives as N SCRAPE_DATA_CHUNK messages and
// then a completion that names N; this reassembles them.
//
// The one rule that matters: an INCOMPLETE transfer must be reported,
// never finished. A missing chunk that quietly produced a shorter
// result would be indistinguishable from a shorter grid — the exact
// failure the truncated-export notice exists to rule out — so
// assembleRows() returns null and the caller says so.
//
// Deliberately world-agnostic (no browser, no DOM), so it unit-tests
// the reassembly directly instead of through a fake message bus.
// ============================================================

import type { ScrapeDataChunkMessage } from "./scraper-types";

/** The chunks seen so far for the transfer in flight. */
export interface ResultChunkBuffer {
  /** By chunk index, not by arrival: arrival order is not the contract. */
  chunks: Map<number, Record<string, unknown>[]>;
  /** The size the transfer declared, once any chunk has declared it. */
  expected: number | null;
}

export function createResultChunkBuffer(): ResultChunkBuffer {
  return { chunks: new Map(), expected: null };
}

/**
 * Record one chunk. A repeated index overwrites rather than appends:
 * a duplicated delivery is a bug to be harmless, not a reason to
 * double the rows.
 */
export function addResultChunk(
  buffer: ResultChunkBuffer,
  message: ScrapeDataChunkMessage,
): ResultChunkBuffer {
  buffer.chunks.set(message.index, message.rows);
  buffer.expected = message.chunks;
  return buffer;
}

/** Which chunk indices of a transfer of `expected` chunks are still missing. */
export function missingResultChunks(
  buffer: ResultChunkBuffer,
  expected: number,
): number[] {
  const missing: number[] = [];
  for (let index = 0; index < expected; index++) {
    if (!buffer.chunks.has(index)) missing.push(index);
  }
  return missing;
}

/**
 * The whole result, in chunk order, or null when a chunk is missing.
 * An empty transfer is an empty array, not null: "no rows" and "lost
 * rows" are different answers and must stay different.
 */
export function assembleRows(
  buffer: ResultChunkBuffer,
  expected: number,
): Record<string, unknown>[] | null {
  if (missingResultChunks(buffer, expected).length > 0) return null;
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < expected; index++) {
    rows.push(...buffer.chunks.get(index)!);
  }
  return rows;
}

/**
 * The rows a completion should hand to the Run: the ones it carries, or
 * the reassembled transfer when it names one.
 *
 * `dataChunks` is the whole discriminator — present means chunked, absent
 * means inline — so a message written before chunking existed needs no
 * special case here.
 */
export function resolveResultRows(
  buffer: ResultChunkBuffer,
  completion: { data: Record<string, unknown>[]; dataChunks?: number },
): Record<string, unknown>[] | null {
  if (completion.dataChunks === undefined) return completion.data;
  return assembleRows(buffer, completion.dataChunks);
}

/** Forget the transfer in flight — after it settles, or after an error. */
export function resetResultChunks(buffer: ResultChunkBuffer): ResultChunkBuffer {
  buffer.chunks.clear();
  buffer.expected = null;
  return buffer;
}