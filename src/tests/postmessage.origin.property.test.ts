// Feature: better-coretax-improvements, Property 9: PostMessage origin guard
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Pure function that replicates the origin guard logic used in scraper.ts
 * (Scraper message listener — expects direction "FROM_CONTENT").
 *
 * Returns true if the message should be processed, false if it should be
 * silently discarded.
 *
 * Source: scraper.ts window.addEventListener("message", ...)
 *   if (event.source !== window) return;
 *   if (event.origin !== window.location.origin) return;
 *   if (!event.data || event.data.direction !== "FROM_CONTENT") return;
 */
function scraperGuard(opts: { sourceMatches: boolean; directionMatches: boolean; originMatches: boolean }): boolean {
  // Guard 1: source must be window
  if (!opts.sourceMatches) return false;
  // Guard 2: origin must match window.location.origin
  if (!opts.originMatches) return false;
  // Guard 3: direction must be "FROM_CONTENT"
  if (!opts.directionMatches) return false;
  return true;
}

describe("PostMessage origin guard — Property 9", () => {
  /**
   * Validates: Requirements 7.3, 7.4, 7.5
   *
   * For any combination of the three guard flags, a message is processed
   * if and only if ALL THREE conditions hold simultaneously:
   *   1. event.source === window          (sourceMatches)
   *   2. direction field matches expected  (directionMatches)
   *   3. event.origin === window.location.origin (originMatches)
   *
   * Any event where one or more conditions fail SHALL be silently discarded.
   */
  it("Content_Script guard: processes message iff sourceMatches && directionMatches && originMatches", async () => {
    // Stub browser globals before dynamic import.
    // `window` is used both for identity comparison (event.source === window)
    // and for accessing window.location.origin.
    const fakeOrigin = "https://example.com";
    const fakeWindow = { location: { origin: fakeOrigin } };
    (globalThis as any).window = fakeWindow;
    (globalThis as any).location = fakeWindow.location;

    const { shouldProcessPageMessage } = await import("../content/postmessage-guard");

    fc.assert(
      fc.property(
        fc.record({
          sourceMatches: fc.boolean(),
          directionMatches: fc.boolean(),
          originMatches: fc.boolean(),
        }),
        (flags) => {
          const result = shouldProcessPageMessage({
            source: flags.sourceMatches ? fakeWindow : null,
            origin: flags.originMatches ? fakeOrigin : "https://other.com",
            data: flags.directionMatches ? { direction: "FROM_PAGE" } : { direction: "OTHER" },
          });

          const expected = flags.sourceMatches && flags.originMatches && flags.directionMatches;
          expect(result).toBe(expected);
        },
      ),
    );
  });

  it("Scraper guard: processes message iff sourceMatches && directionMatches && originMatches", () => {
    fc.assert(
      fc.property(
        fc.record({
          sourceMatches: fc.boolean(),
          directionMatches: fc.boolean(),
          originMatches: fc.boolean(),
        }),
        (flags) => {
          const shouldProcess = flags.sourceMatches && flags.directionMatches && flags.originMatches;

          const result = scraperGuard(flags);

          expect(result).toBe(shouldProcess);
        },
      ),
    );
  });

  it("guard rejects when only sourceMatches is false", () => {
    fc.assert(
      fc.property(
        fc.record({
          sourceMatches: fc.boolean(),
          directionMatches: fc.boolean(),
          originMatches: fc.boolean(),
        }),
        (flags) => {
          if (!flags.sourceMatches) {
            // Source guard fails → must discard regardless of other flags
            expect(scraperGuard(flags)).toBe(false);
          }
        },
      ),
    );
  });

  it("guard rejects when only originMatches is false", () => {
    fc.assert(
      fc.property(
        fc.record({
          sourceMatches: fc.boolean(),
          directionMatches: fc.boolean(),
          originMatches: fc.boolean(),
        }),
        (flags) => {
          if (!flags.originMatches) {
            // Origin guard fails → must discard regardless of other flags
            expect(scraperGuard(flags)).toBe(false);
          }
        },
      ),
    );
  });

  it("guard rejects when only directionMatches is false", () => {
    fc.assert(
      fc.property(
        fc.record({
          sourceMatches: fc.boolean(),
          directionMatches: fc.boolean(),
          originMatches: fc.boolean(),
        }),
        (flags) => {
          if (!flags.directionMatches) {
            // Direction guard fails → must discard regardless of other flags
            expect(scraperGuard(flags)).toBe(false);
          }
        },
      ),
    );
  });

  it("guard processes message only when all three flags are true", () => {
    // Exhaustive check over all 8 combinations
    const allCombinations = [
      { sourceMatches: false, directionMatches: false, originMatches: false },
      { sourceMatches: false, directionMatches: false, originMatches: true },
      { sourceMatches: false, directionMatches: true, originMatches: false },
      { sourceMatches: false, directionMatches: true, originMatches: true },
      { sourceMatches: true, directionMatches: false, originMatches: false },
      { sourceMatches: true, directionMatches: false, originMatches: true },
      { sourceMatches: true, directionMatches: true, originMatches: false },
      { sourceMatches: true, directionMatches: true, originMatches: true },
    ];

    for (const flags of allCombinations) {
      const expected = flags.sourceMatches && flags.directionMatches && flags.originMatches;
      expect(scraperGuard(flags)).toBe(expected);
    }
  });
});
