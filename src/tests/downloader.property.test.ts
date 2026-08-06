// Feature: cindieh-improvements, Property 1: base64ToBlob round-trip
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { base64ToBlob } from "../content/downloader";

/**
 * Property 1: base64ToBlob round-trip
 *
 * For any non-empty, valid canonical base64-encoded string, converting it to a
 * Blob via base64ToBlob and then reading the Blob's ArrayBuffer and re-encoding
 * it to base64 SHALL produce a string byte-for-byte equal to the original input.
 *
 * Note: We filter to canonical base64 strings only (where btoa(atob(s)) === s).
 * Non-canonical base64 strings (where padding bits are non-zero) are technically
 * accepted by atob but the round-trip produces the canonical form, which differs
 * from the non-canonical input. The property holds for canonical base64.
 *
 * Validates: Requirements 2.2, 2.3
 */
describe("base64ToBlob - Property 1: round-trip", () => {
  it("should round-trip: base64 -> Blob -> ArrayBuffer -> base64 equals original", async () => {
    // Filter to canonical base64 strings: btoa(atob(s)) === s
    // This excludes non-canonical strings where padding bits are non-zero
    const canonicalBase64 = fc
      .base64String({ minLength: 1 })
      .filter((s) => btoa(atob(s)) === s);

    await fc.assert(
      fc.asyncProperty(canonicalBase64, async (b64) => {
        const blob = base64ToBlob(b64);
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (const byte of bytes) {
          binary += String.fromCharCode(byte);
        }
        const reEncoded = btoa(binary);
        expect(reEncoded).toBe(b64);
      })
    );
  });
});
