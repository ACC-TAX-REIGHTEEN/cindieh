// Feature: cindieh-improvements, Property 2: base64ToBlob rejects invalid input
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { base64ToBlob } from "../content/downloader";

/**
 * A string is "invalid base64" if atob actually throws when trying to decode it.
 * Note: atob silently ignores ASCII whitespace (space, tab, newline, etc.) per
 * the HTML spec, so strings containing only whitespace alongside valid base64
 * chars may not throw. We use atob itself as the oracle for what is truly invalid.
 */
const isInvalidBase64 = (s: string): boolean => {
  try {
    atob(s);
    return false; // atob accepted it — not invalid from atob's perspective
  } catch {
    return true; // atob rejected it — this is what we want to test
  }
};

describe("base64ToBlob - Property 2: rejects invalid input", () => {
  /**
   * Validates: Requirements 2.5
   *
   * When the Downloader receives an empty string as input, it SHALL throw an
   * Error indicating the input is empty.
   */
  it("should throw for empty string", () => {
    expect(() => base64ToBlob("")).toThrow();
  });

  /**
   * Validates: Requirements 2.4, 2.5
   *
   * For any string that is either empty or contains characters outside the
   * base64 alphabet, calling base64ToBlob SHALL throw an Error rather than
   * returning a silently corrupted Blob.
   */
  it("should throw for strings with non-base64 characters", () => {
    fc.assert(
      fc.property(
        fc.string().filter(isInvalidBase64),
        (invalidStr) => {
          expect(() => base64ToBlob(invalidStr)).toThrow();
        },
      ),
    );
  });
});
