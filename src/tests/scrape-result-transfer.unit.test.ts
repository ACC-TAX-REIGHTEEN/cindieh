import { describe, expect, it, vi } from "vitest";
import type { ScrapeComplete, ScrapeMessage } from "../content/scraper-types";
import {
  SCRAPE_CHUNK_ROWS,
  chunkRows,
  sendScrapeComplete,
  shouldChunk,
} from "../content/scrape-result-transfer";
import {
  addResultChunk,
  assembleRows,
  createResultChunkBuffer,
  missingResultChunks,
  resetResultChunks,
  resolveResultRows,
} from "../content/result-chunks";

/** A completion carrying `count` rows, with everything else left at defaults. */
const completion = (count: number): ScrapeComplete => ({
  type: "SCRAPE_COMPLETE",
  data: Array.from({ length: count }, (_, i) => ({ RecordId: i })),
  fields: ["RecordId"],
  total: count,
  pages: 1,
  elapsed: "1s",
  source: "OUTPUT_TAX",
});

const ids = (rows: Record<string, unknown>[]): unknown[] => rows.map((r) => r.RecordId);

describe("sending a scrape result across the bridge", () => {
  it("leaves a small result in the completion itself", () => {
    // Unchanged behaviour for every run below the threshold: one message,
    // rows inline, no dataChunks flag.
    const send = vi.fn<(m: ScrapeMessage) => void>();
    const message = completion(SCRAPE_CHUNK_ROWS);

    sendScrapeComplete(send, message);

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(message);
  });

  it("splits a large result into chunks ahead of the completion", () => {
    const send = vi.fn<(m: ScrapeMessage) => void>();
    const rows = completion(SCRAPE_CHUNK_ROWS + 1).data;

    sendScrapeComplete(send, completion(SCRAPE_CHUNK_ROWS + 1));

    // Two chunks, then the completion — in that order, because a chunk that
    // arrives after the completion would be discarded with the buffer.
    expect(send).toHaveBeenCalledTimes(3);
    const [first, second, last] = send.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ type: "SCRAPE_DATA_CHUNK", index: 0, chunks: 2 });
    expect(second).toMatchObject({ type: "SCRAPE_DATA_CHUNK", index: 1, chunks: 2 });
    expect(last).toMatchObject({ type: "SCRAPE_COMPLETE", dataChunks: 2 });

    // Every chunk declares the same total, or the receiver cannot check it.
    expect((first as { chunks: number }).chunks).toBe((second as { chunks: number }).chunks);

    // And between them they carry every row, in order, exactly once.
    const carried = send.mock.calls
      .filter((c) => (c[0] as { type: string }).type === "SCRAPE_DATA_CHUNK")
      .flatMap((c) => (c[0] as { rows: Record<string, unknown>[] }).rows);
    expect(carried).toHaveLength(rows.length);
    expect(ids(carried)).toEqual(ids(rows));
  });

  it("empties data in the completion of a chunked result", () => {
    // A receiver that lost a chunk must see an obviously empty result rather
    // than a plausible-looking partial one.
    const send = vi.fn<(m: ScrapeMessage) => void>();

    sendScrapeComplete(send, completion(SCRAPE_CHUNK_ROWS * 3 + 7));

    const last = send.mock.calls[send.mock.calls.length - 1][0];
    expect(last).toMatchObject({ type: "SCRAPE_COMPLETE", data: [] });
  });

  it("keeps the rest of the completion intact", () => {
    const send = vi.fn<(m: ScrapeMessage) => void>();
    const message: ScrapeComplete = {
      ...completion(SCRAPE_CHUNK_ROWS + 1),
      partial: true,
      truncated: true,
      expectedTotal: 9999,
      failedItems: ["01-2026-BP-001-PT Contoh.pdf"],
      filenameHint: "SRC-072026",
      kind: "pdf",
    };

    sendScrapeComplete(send, message);

    const last = send.mock.calls[send.mock.calls.length - 1][0] as ScrapeComplete;
    expect(last).toMatchObject({
      total: message.total,
      pages: message.pages,
      elapsed: message.elapsed,
      source: message.source,
      fields: message.fields,
      partial: true,
      truncated: true,
      expectedTotal: 9999,
      failedItems: message.failedItems,
      filenameHint: "SRC-072026",
      kind: "pdf",
    });
  });

  it("never chunks an empty result", () => {
    const send = vi.fn<(m: ScrapeMessage) => void>();

    sendScrapeComplete(send, completion(0));

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(completion(0));
  });

  it("chunks exactly at the threshold", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ RecordId: i }));
    expect(shouldChunk(rows, 10)).toBe(false);
    expect(shouldChunk(rows, 9)).toBe(true);
    expect(chunkRows(rows, 4).map((c) => c.rows.length)).toEqual([4, 4, 2]);
  });
});

describe("receiving a chunked scrape result", () => {
  /** Feed a chunk buffer the chunks of `count` rows, in the given index order. */
  function feed(count: number, size: number, order?: number[]): ReturnType<typeof createResultChunkBuffer> {
    const chunks = chunkRows(Array.from({ length: count }, (_, i) => ({ RecordId: i })), size);
    return feedChunks(order ?? chunks.map((c) => c.index), chunks);
  }

  /** Feed exactly these chunk indices out of a prepared set. */
  function feedChunks(
    indexes: number[],
    chunks: ReturnType<typeof chunkRows>,
  ): ReturnType<typeof createResultChunkBuffer> {
    const buffer = createResultChunkBuffer();
    for (const index of indexes) addResultChunk(buffer, chunks[index]);
    return buffer;
  }

  it("assembles the rows in chunk order, not arrival order", () => {
    // Every chunk is there; they simply did not arrive in order. postMessage
    // between one pair preserves order, so this is belt and braces — but the
    // index is the contract, and the rows come out as if they had.
    const buffer = feed(10, 3, [2, 0, 3, 1]);
    const rows = assembleRows(buffer, 4)!;

    expect(ids(rows)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("refuses to finish an incomplete transfer", () => {
    // The rule that matters: a lost chunk must never look like a short grid.
    const chunks = chunkRows(Array.from({ length: 10 }, (_, i) => ({ RecordId: i })), 3);
    const partial = feedChunks([0, 2, 3], chunks);

    expect(assembleRows(partial, 4)).toBeNull();
    expect(missingResultChunks(partial, 4)).toEqual([1]);
    // And the complete set it would have been is still assembleable, so the
    // null above is about the gap and not about the chunking itself.
    expect(assembleRows(feedChunks([0, 1, 2, 3], chunks), 4)!.length).toBe(10);
  });

  it("reports an empty transfer as empty, not as missing", () => {
    expect(assembleRows(createResultChunkBuffer(), 0)).toEqual([]);
  });

  it("ignores a chunk that arrives twice rather than doubling its rows", () => {
    const chunks = chunkRows(Array.from({ length: 6 }, (_, i) => ({ RecordId: i })), 2);
    const buffer = feedChunks([0, 1, 2], chunks);
    addResultChunk(buffer, chunks[1]);

    expect(assembleRows(buffer, 3)!.length).toBe(6);
  });

  it("hands the inline rows straight through when there was no transfer", () => {
    const buffer = createResultChunkBuffer();
    const rows = [{ RecordId: 1 }, { RecordId: 2 }];

    expect(resolveResultRows(buffer, { data: rows })).toBe(rows);
  });

  it("hands the reassembled rows when the completion names a transfer", () => {
    const buffer = feed(5, 2);

    expect(resolveResultRows(buffer, { data: [], dataChunks: 3 })!.length).toBe(5);
  });

  it("forgets the transfer when the run is reset", () => {
    // Otherwise the next export's chunk 0 would land in the previous run's
    // buffer and be reported as that run's data.
    const buffer = feed(4, 2);
    resetResultChunks(buffer);

    expect(buffer.chunks.size).toBe(0);
    expect(buffer.expected).toBeNull();
    expect(assembleRows(buffer, 2)).toBeNull();
  });
});

describe("a result that crosses the bridge whole", () => {
  it("is what the sender produces below the threshold", () => {
    // The end-to-end shape, for the ordinary case: one message, rows inline.
    const send = vi.fn<(m: ScrapeMessage) => void>();
    sendScrapeComplete(send, completion(37));

    const received: ScrapeMessage[] = [];
    const buffer = createResultChunkBuffer();
    for (const message of send.mock.calls.map((c) => c[0])) {
      received.push(message);
      if ((message as ScrapeDataChunkLike).type === "SCRAPE_DATA_CHUNK") {
        addResultChunk(buffer, message as never);
      }
    }
    const completionMessage = received[received.length - 1] as ScrapeComplete;

    expect(resolveResultRows(buffer, completionMessage)!.length).toBe(37);
  });

  it("round-trips a large result through both halves unchanged", () => {
    const send = vi.fn<(m: ScrapeMessage) => void>();
    const original = completion(SCRAPE_CHUNK_ROWS * 2 + 5);

    sendScrapeComplete(send, original);

    const buffer = createResultChunkBuffer();
    for (const call of send.mock.calls) {
      const message = call[0];
      if ((message as ScrapeDataChunkLike).type === "SCRAPE_DATA_CHUNK") {
        addResultChunk(buffer, message as never);
      }
    }
    const completionMessage = send.mock.calls[send.mock.calls.length - 1][0] as ScrapeComplete;

    expect(resolveResultRows(buffer, completionMessage)).toEqual(original.data);
  });
});

/** Just the discriminant, so the guard above stays readable. */
interface ScrapeDataChunkLike {
  type: string;
}