// Feature: better-coretax-improvements, Property 9: PostMessage origin guard
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { shouldProcessPageMessage } from "../content/postmessage-guard";

/**
 * Pure function that replicates the origin guard logic used in scraper.ts
 * (Scraper message listener — expects direction "FROM_CONTENT").
 *
 * Returns true if the message should be processed, false if it should be
 * silently discarded.
 */
function scraperGuard(opts: { sourceMatches: boolean; directionMatches: boolean; originMatches: boolean }): boolean {
  if (!opts.sourceMatches) return false;
  if (!opts.originMatches) return false;
  if (!opts.directionMatches) return false;
  return true;
}

const FAKE_ORIGIN = "https://coretaxdjp.pajak.go.id";
const fakeWindow = { location: { origin: FAKE_ORIGIN } } as Window & typeof globalThis;

describe("PostMessage origin guard — Property 9", () => {
  /**
   * Validates: Requirements 7.3, 7.4, 7.5
   *
   * For any combination of the three guard flags, a message is processed
   * if and only if ALL THREE conditions hold simultaneously.
   */
  it("Content_Script guard: processes message iff sourceMatches && directionMatches && originMatches", () => {
    fc.assert(
      fc.property(
        fc.record({
          sourceMatches: fc.boolean(),
          directionMatches: fc.boolean(),
          originMatches: fc.boolean(),
        }),
        (flags) => {
          const result = shouldProcessPageMessage(
            {
              source: flags.sourceMatches ? fakeWindow : null,
              origin: flags.originMatches ? FAKE_ORIGIN : "https://other.com",
              data: flags.directionMatches ? { direction: "FROM_PAGE" } : { direction: "OTHER" },
            },
            undefined,
            fakeWindow,
          );

          const expected = flags.sourceMatches && flags.originMatches && flags.directionMatches;
          expect(result).toBe(expected);
        },
      ),
    );
  });

  it("token validation: rejects when token does not match", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 36 }),
        fc.string({ minLength: 1, maxLength: 36 }),
        (correctToken, wrongToken) => {
          fc.pre(correctToken !== wrongToken);
          const result = shouldProcessPageMessage(
            {
              source: fakeWindow,
              origin: FAKE_ORIGIN,
              data: { direction: "FROM_PAGE", token: wrongToken },
            },
            correctToken,
            fakeWindow,
          );
          expect(result).toBe(false);
        },
      ),
    );
  });

  it("token validation: accepts when token matches", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 36 }),
        (token) => {
          const result = shouldProcessPageMessage(
            {
              source: fakeWindow,
              origin: FAKE_ORIGIN,
              data: { direction: "FROM_PAGE", token },
            },
            token,
            fakeWindow,
          );
          expect(result).toBe(true);
        },
      ),
    );
  });

  it("token validation: accepts when no expectedToken is provided (undefined)", () => {
    const result = shouldProcessPageMessage(
      {
        source: fakeWindow,
        origin: FAKE_ORIGIN,
        data: { direction: "FROM_PAGE" },
      },
      undefined,
      fakeWindow,
    );
    expect(result).toBe(true);
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
          const result = scraperGuard(flags);
          expect(result).toBe(flags.sourceMatches && flags.directionMatches && flags.originMatches);
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
            expect(scraperGuard(flags)).toBe(false);
          }
        },
      ),
    );
  });

  it("guard processes message only when all three flags are true", () => {
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
