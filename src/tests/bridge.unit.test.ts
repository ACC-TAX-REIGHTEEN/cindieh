import { describe, it, expect, vi, afterEach } from "vitest";
import { generateBridgeToken, getBridgeToken, setBridgeToken, postToScraper } from "../content/bridge";

describe("bridge.ts — bridge token generation and messaging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates and stores a unique token", () => {
    const token1 = generateBridgeToken();
    expect(token1).toBeTruthy();
    expect(getBridgeToken()).toBe(token1);

    const token2 = generateBridgeToken();
    expect(token2).toBeTruthy();
    expect(token2).not.toBe(token1);
  });

  it("allows setting token manually", () => {
    setBridgeToken("test-custom-token");
    expect(getBridgeToken()).toBe("test-custom-token");
  });

  it("posts message to page with FROM_CONTENT direction and bridge token", () => {
    setBridgeToken("active-token-123");
    const postMessageMock = vi.fn();
    const originalWindow = globalThis.window;

    Object.defineProperty(globalThis, "window", {
      value: {
        location: { origin: "https://coretaxdjp.pajak.go.id" },
        postMessage: postMessageMock,
      },
      writable: true,
      configurable: true,
    });

    postToScraper({ type: "START_SCRAPE" });

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(postMessageMock).toHaveBeenCalledWith(
      { type: "START_SCRAPE", direction: "FROM_CONTENT", token: "active-token-123" },
      "https://coretaxdjp.pajak.go.id",
    );

    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
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

    const token = generateBridgeToken();
    expect(token).toBe("abababababababababababababababab");
    expect(getRandomValuesMock).toHaveBeenCalled();

    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      writable: true,
      configurable: true,
    });
  });
});
