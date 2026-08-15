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
      { type: "START_SCRAPE", direction: "FROM_CONTENT", token: "active-token-123" },
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
        { type: "START_SCRAPE", direction: "FROM_CONTENT", token: "singleton-active" },
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
