// Unit tests for bridge.ts — bridge token generation and messaging.
// Each test builds its own bridge via createBridge() so no shared
// module-level state leaks between cases (audit: order-dependency).
import { describe, it, expect, vi } from "vitest";
import {
  createBridge,
  generateBridgeToken,
  getBridgeToken,
  setBridgeToken,
  postToScraper,
} from "../content/bridge";

describe("createBridge — token generation and messaging", () => {
  it("generates and stores a unique token", () => {
    const b = createBridge();
    const token1 = b.generateBridgeToken();
    expect(token1).toBeTruthy();
    expect(b.getBridgeToken()).toBe(token1);

    const token2 = b.generateBridgeToken();
    expect(token2).toBeTruthy();
    expect(token2).not.toBe(token1);
  });

  it("rejects queued results after stop, navigation, and a replacement run", () => {
    const win = { location: { origin: "https://coretaxdjp.pajak.go.id", href: "https://coretaxdjp.pajak.go.id/a" }, postMessage: vi.fn() };
    const b = createBridge(win as unknown as Window);
    b.postToScraper({ type: "START_SCRAPE" });
    const first = b.getActiveRunId();
    expect(b.isCurrentRunMessage({ type: "SCRAPE_COMPLETE", runId: first })).toBe(true);
    b.postToScraper({ type: "START_SCRAPE", runId: first });
    expect(b.getActiveRunId()).toBe(first);
    win.location.href = "https://coretaxdjp.pajak.go.id/b";
    expect(b.isCurrentRunMessage({ type: "SCRAPE_COMPLETE", runId: first })).toBe(false);
    b.postToScraper({ type: "RESET_SCRAPER" });
    b.postToScraper({ type: "START_SCRAPE" });
    expect(b.isCurrentRunMessage({ type: "SCRAPE_COMPLETE", runId: first })).toBe(false);
    const next = b.getActiveRunId();
    expect(b.isCurrentRunMessage({ type: "DOWNLOAD_PDF_ITEM", runId: next })).toBe(true);
    b.postToScraper({ type: "STOP_SCRAPE" });
    expect(b.isCurrentRunMessage({ type: "DOWNLOAD_PDF_ITEM", runId: next })).toBe(false);
    expect(b.isCurrentRunMessage({ type: "SCRAPE_COMPLETE" })).toBe(false);
    expect(b.isCurrentRunMessage({ type: "INJECTED_READY" })).toBe(true);
    expect(b.isCurrentRunMessage({ type: "DOWNLOAD_PDF_ITEM" })).toBe(true);
    // Unscoped too: the reference-search miss report is not a scrape operation.
    expect(b.isCurrentRunMessage({ type: "REFERENCE_SEARCH_NOT_FOUND" })).toBe(true);
  });

  it("admits the stopped Run's salvage report, and nothing else under its id", () => {
    const win = {
      location: { origin: "https://coretaxdjp.pajak.go.id", href: "https://coretaxdjp.pajak.go.id/a" },
      postMessage: vi.fn(),
    };
    const b = createBridge(win as unknown as Window);
    b.postToScraper({ type: "START_SCRAPE" });
    const stopped = b.getActiveRunId();
    b.postToScraper({ type: "STOP_SCRAPE" });
    const next = b.getActiveRunId();

    // The one report a stop must still recognise: a stopped sweep describes
    // itself AFTER the stop, so it necessarily arrives under the retired id.
    expect(b.isStoppedRunMessage({ type: "SCRAPE_COMPLETE", runId: stopped })).toBe(true);
    // ...while the ordinary current-run test refuses it, which is what keeps the
    // exception to a single message type in main.ts.
    expect(b.isCurrentRunMessage({ type: "SCRAPE_COMPLETE", runId: stopped })).toBe(false);
    // The bridge answers the ID question only; WHICH message types may use that
    // window is the router's call (main.ts admits exactly one).
    expect(b.isStoppedRunMessage({ type: "SCRAPE_PROGRESS", runId: stopped })).toBe(true);
    // Not the live run, and not an unscoped message either.
    expect(b.isStoppedRunMessage({ type: "SCRAPE_COMPLETE", runId: next })).toBe(false);
    expect(b.isStoppedRunMessage({ type: "SCRAPE_COMPLETE" })).toBe(false);

    // A teardown leaves nothing behind, and that includes no salvage window.
    b.postToScraper({ type: "RESET_SCRAPER" });
    expect(b.isStoppedRunMessage({ type: "SCRAPE_COMPLETE", runId: next })).toBe(false);
  });

  it("has no salvage window before any stop", () => {
    const win = {
      location: { origin: "https://coretaxdjp.pajak.go.id", href: "https://coretaxdjp.pajak.go.id/a" },
      postMessage: vi.fn(),
    };
    const b = createBridge(win as unknown as Window);
    b.postToScraper({ type: "START_SCRAPE" });
    expect(b.isStoppedRunMessage({ type: "SCRAPE_COMPLETE", runId: b.getActiveRunId() })).toBe(false);
  });

  it("rejects a stale completion after the page URL changes without any new run", () => {
    const win = {
      location: { origin: "https://coretaxdjp.pajak.go.id", href: "https://coretaxdjp.pajak.go.id/a" },
      postMessage: vi.fn(),
    };
    const b = createBridge(win as unknown as Window);
    b.postToScraper({ type: "START_SCRAPE" });
    const runId = b.getActiveRunId();
    expect(b.isCurrentRunMessage({ type: "SCRAPE_COMPLETE", runId })).toBe(true);

    // SPA navigation: only the URL changes (RESET_SCRAPER may not have arrived yet).
    win.location.href = "https://coretaxdjp.pajak.go.id/b";
    expect(b.isCurrentRunMessage({ type: "SCRAPE_COMPLETE", runId })).toBe(false);
    expect(b.isCurrentRunMessage({ type: "SCRAPE_PROGRESS", runId })).toBe(false);

    // Back on the original URL the run is current again.
    win.location.href = "https://coretaxdjp.pajak.go.id/a";
    expect(b.isCurrentRunMessage({ type: "SCRAPE_COMPLETE", runId })).toBe(true);
  });

  it("allows setting token manually", () => {
    const b = createBridge();
    b.setBridgeToken("test-custom-token");
    expect(b.getBridgeToken()).toBe("test-custom-token");
  });

  it("posts message to page with FROM_CONTENT direction and bridge token", () => {
    const postMessageMock = vi.fn();
    const windowStub = {
      location: { origin: "https://coretaxdjp.pajak.go.id" },
      postMessage: postMessageMock,
    } as unknown as Window;
    const b = createBridge(windowStub);
    b.setBridgeToken("active-token-123");

    b.postToScraper({ type: "START_SCRAPE" });

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(postMessageMock).toHaveBeenCalledWith(
      { type: "START_SCRAPE", runId: 1, direction: "FROM_CONTENT", token: "active-token-123" },
      "https://coretaxdjp.pajak.go.id",
    );
  });

  it("uses crypto.getRandomValues fallback when randomUUID throws or is missing", () => {
    const originalCrypto = globalThis.crypto;
    const getRandomValuesMock = vi.fn((array: Uint8Array) => {
      array.fill(0xab);
      return array;
    });

    Object.defineProperty(globalThis, "crypto", {
      value: {
        randomUUID: undefined,
        getRandomValues: getRandomValuesMock,
      },
      writable: true,
      configurable: true,
    });

    try {
      const b = createBridge();
      const token = b.generateBridgeToken();
      expect(token).toBe("abababababababababababababababab");
      expect(getRandomValuesMock).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: originalCrypto,
        writable: true,
        configurable: true,
      });
    }
  });

  it("keeps instances isolated — token changes never leak across bridges", () => {
    const a = createBridge();
    const b = createBridge();

    a.setBridgeToken("token-a");
    b.generateBridgeToken();

    expect(a.getBridgeToken()).toBe("token-a");
    expect(b.getBridgeToken()).not.toBe("token-a");
  });
});

describe("module singleton — named exports delegate to one bridge", () => {
  it("set/get/generate roundtrip through the shared singleton", () => {
    setBridgeToken("singleton-token");
    expect(getBridgeToken()).toBe("singleton-token");

    const token = generateBridgeToken();
    expect(token).toBeTruthy();
    expect(getBridgeToken()).toBe(token);
  });

  it("posts through the global window with the singleton token", () => {
    const originalWindow = globalThis.window;
    const postMessageMock = vi.fn();
    Object.defineProperty(globalThis, "window", {
      value: {
        location: { origin: "https://coretaxdjp.pajak.go.id" },
        postMessage: postMessageMock,
      },
      writable: true,
      configurable: true,
    });

    try {
      setBridgeToken("singleton-active");
      postToScraper({ type: "START_SCRAPE" });

      expect(postMessageMock).toHaveBeenCalledTimes(1);
      expect(postMessageMock).toHaveBeenCalledWith(
        { type: "START_SCRAPE", runId: expect.any(Number), direction: "FROM_CONTENT", token: "singleton-active" },
        "https://coretaxdjp.pajak.go.id",
      );
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        writable: true,
        configurable: true,
      });
    }
  });
});
