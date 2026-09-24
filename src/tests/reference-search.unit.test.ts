// Unit tests for reference-search.ts — the Reference filter's match mode.
//
// The behaviour under test is a measured one (tools/README.md, 24 Sep 2026):
// `startswith` answers in ~0.1 s while `contains` can take ~97 s on the same
// data. Since ADR-0012 the extension sends the prefix match only and stops
// when it returns nothing — there is no wide-match retry left to test.
import { describe, expect, it } from "vitest";
import { REFERENCE_FIELD, REFERENCE_FAST_MATCH_MODE } from "../content/reference-search";

describe("reference-search — match mode constants", () => {
  it("keeps the prefix match as the one and only match mode", () => {
    expect(REFERENCE_FAST_MATCH_MODE).toBe("startswith");
    expect(REFERENCE_FIELD).toBe("Reference");
  });
});
