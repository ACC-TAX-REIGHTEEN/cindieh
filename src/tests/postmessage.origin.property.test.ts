// Feature: cindieh-improvements, Property 9: PostMessage origin guard
import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { shouldProcessPageMessage, createMessageDispatcher } from "../content/postmessage-guard";

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

  it("FROM_CONTENT direction is rejected by the FROM_PAGE guard", () => {
    const result = shouldProcessPageMessage(
      {
        source: fakeWindow,
        origin: FAKE_ORIGIN,
        data: { direction: "FROM_CONTENT", token: "tok" },
      },
      "tok",
      fakeWindow,
    );
    expect(result).toBe(false);
  });

  it("FROM_PAGE direction is rejected by the FROM_CONTENT guard", () => {
    const result = shouldProcessPageMessage(
      {
        source: fakeWindow,
        origin: FAKE_ORIGIN,
        data: { direction: "FROM_PAGE", token: "tok" },
      },
      "tok",
      fakeWindow,
      "FROM_CONTENT",
    );
    expect(result).toBe(false);
  });

  it("FROM_CONTENT guard accepts direction FROM_CONTENT", () => {
    const result = shouldProcessPageMessage(
      {
        source: fakeWindow,
        origin: FAKE_ORIGIN,
        data: { direction: "FROM_CONTENT", token: "tok" },
      },
      "tok",
      fakeWindow,
      "FROM_CONTENT",
    );
    expect(result).toBe(true);
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

  it("FROM_CONTENT guard: processes message iff sourceMatches && directionMatches && originMatches", () => {
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
              data: flags.directionMatches ? { direction: "FROM_CONTENT" } : { direction: "OTHER" },
            },
            undefined,
            fakeWindow,
            "FROM_CONTENT",
          );
          expect(result).toBe(flags.sourceMatches && flags.directionMatches && flags.originMatches);
        },
      ),
    );
  });

  it("guard rejects when only sourceMatches is false (both directions)", () => {
    fc.assert(
      fc.property(
        fc.record({
          sourceMatches: fc.boolean(),
          directionMatches: fc.boolean(),
          originMatches: fc.boolean(),
        }),
        (flags) => {
          if (!flags.sourceMatches) {
            const page = shouldProcessPageMessage(
              { source: null, origin: flags.originMatches ? FAKE_ORIGIN : "x", data: flags.directionMatches ? { direction: "FROM_PAGE" } : { direction: "OTHER" } },
              undefined,
              fakeWindow,
            );
            const content = shouldProcessPageMessage(
              { source: null, origin: flags.originMatches ? FAKE_ORIGIN : "x", data: flags.directionMatches ? { direction: "FROM_CONTENT" } : { direction: "OTHER" } },
              undefined,
              fakeWindow,
              "FROM_CONTENT",
            );
            expect(page).toBe(false);
            expect(content).toBe(false);
          }
        },
      ),
    );
  });

  it("guard rejects when only originMatches is false (both directions)", () => {
    fc.assert(
      fc.property(
        fc.record({
          sourceMatches: fc.boolean(),
          directionMatches: fc.boolean(),
          originMatches: fc.boolean(),
        }),
        (flags) => {
          if (!flags.originMatches) {
            const page = shouldProcessPageMessage(
              { source: flags.sourceMatches ? fakeWindow : null, origin: "https://other.com", data: flags.directionMatches ? { direction: "FROM_PAGE" } : { direction: "OTHER" } },
              undefined,
              fakeWindow,
            );
            const content = shouldProcessPageMessage(
              { source: flags.sourceMatches ? fakeWindow : null, origin: "https://other.com", data: flags.directionMatches ? { direction: "FROM_CONTENT" } : { direction: "OTHER" } },
              undefined,
              fakeWindow,
              "FROM_CONTENT",
            );
            expect(page).toBe(false);
            expect(content).toBe(false);
          }
        },
      ),
    );
  });

  it("guard rejects when only directionMatches is false (both directions)", () => {
    fc.assert(
      fc.property(
        fc.record({
          sourceMatches: fc.boolean(),
          directionMatches: fc.boolean(),
          originMatches: fc.boolean(),
        }),
        (flags) => {
          if (!flags.directionMatches) {
            const page = shouldProcessPageMessage(
              { source: flags.sourceMatches ? fakeWindow : null, origin: flags.originMatches ? FAKE_ORIGIN : "x", data: { direction: "OTHER" } },
              undefined,
              fakeWindow,
            );
            const content = shouldProcessPageMessage(
              { source: flags.sourceMatches ? fakeWindow : null, origin: flags.originMatches ? FAKE_ORIGIN : "x", data: { direction: "OTHER" } },
              undefined,
              fakeWindow,
              "FROM_CONTENT",
            );
            expect(page).toBe(false);
            expect(content).toBe(false);
          }
        },
      ),
    );
  });
});

// ── createMessageDispatcher ───────────────────────────────────────────────────

describe("createMessageDispatcher", () => {
  const dispatcher = (opts: Parameters<typeof createMessageDispatcher>[0]) =>
    createMessageDispatcher(opts);

  it("dispatches a validated message to the handler for its type", () => {
    const spy = vi.fn();
    const d = dispatcher({
      direction: "FROM_PAGE",
      token: "tok",
      handlers: { PING: spy },
      selfWindow: fakeWindow,
    });
    d.handle({
      source: fakeWindow,
      origin: FAKE_ORIGIN,
      data: { type: "PING", payload: 1, direction: "FROM_PAGE", token: "tok" },
    });
    expect(spy).toHaveBeenCalledWith({ type: "PING", payload: 1 });
  });

  it("strips direction and token before calling the handler", () => {
    let received: Record<string, unknown> | undefined;
    const d = dispatcher({
      direction: "FROM_CONTENT",
      token: "tok",
      handlers: { START: (msg) => (received = msg) },
      selfWindow: fakeWindow,
    });
    d.handle({
      source: fakeWindow,
      origin: FAKE_ORIGIN,
      data: { type: "START", direction: "FROM_CONTENT", token: "tok", field: "x" },
    });
    expect(received).toEqual({ type: "START", field: "x" });
  });

  it("drops messages with a mismatched token", () => {
    const spy = vi.fn();
    const d = dispatcher({
      direction: "FROM_PAGE",
      token: "tok",
      handlers: { PING: spy },
      selfWindow: fakeWindow,
    });
    d.handle({
      source: fakeWindow,
      origin: FAKE_ORIGIN,
      data: { type: "PING", direction: "FROM_PAGE", token: "WRONG" },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops messages with the wrong direction", () => {
    const spy = vi.fn();
    const d = dispatcher({
      direction: "FROM_PAGE",
      token: "tok",
      handlers: { PING: spy },
      selfWindow: fakeWindow,
    });
    d.handle({
      source: fakeWindow,
      origin: FAKE_ORIGIN,
      data: { type: "PING", direction: "FROM_CONTENT", token: "tok" },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("silently drops unknown message types", () => {
    const spy = vi.fn();
    const d = dispatcher({
      direction: "FROM_PAGE",
      token: "tok",
      handlers: { PING: spy },
      selfWindow: fakeWindow,
    });
    d.handle({
      source: fakeWindow,
      origin: FAKE_ORIGIN,
      data: { type: "UNKNOWN", direction: "FROM_PAGE", token: "tok" },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops messages with a non-string or missing type", () => {
    const spy = vi.fn();
    const d = dispatcher({
      direction: "FROM_PAGE",
      token: "tok",
      handlers: { PING: spy },
      selfWindow: fakeWindow,
    });
    d.handle({
      source: fakeWindow,
      origin: FAKE_ORIGIN,
      data: { direction: "FROM_PAGE", token: "tok" },
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
