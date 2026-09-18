import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEBUG_QUERY_PARAM,
  DEBUG_STORAGE_KEY,
  debugError,
  debugFlagFromUrl,
  debugLog,
  debugWarn,
  disableDebug,
  enableDebug,
  isDebugEnabled,
  parseDebugFlag,
  resolveDebugEnabled,
} from "../content/debug";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  disableDebug();
});

describe("parseDebugFlag", () => {
  it("accepts the on words regardless of case or surrounding space", () => {
    for (const raw of ["1", "true", "on", "yes", " TRUE ", "On"]) {
      expect(parseDebugFlag(raw)).toBe(true);
    }
  });

  it("accepts the off words", () => {
    for (const raw of ["0", "false", "off", "no", " OFF "]) {
      expect(parseDebugFlag(raw)).toBe(false);
    }
  });

  it("returns null for unset, blank, or unrecognised values so callers fall through", () => {
    for (const raw of [null, undefined, "", "   ", "maybe", "2"]) {
      expect(parseDebugFlag(raw)).toBeNull();
    }
  });
});

describe("debugFlagFromUrl", () => {
  it("reads the query parameter off a portal URL", () => {
    const base = "https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax";
    expect(debugFlagFromUrl(`${base}?${DEBUG_QUERY_PARAM}=1`)).toBe(true);
    expect(debugFlagFromUrl(`${base}?${DEBUG_QUERY_PARAM}=0`)).toBe(false);
    expect(debugFlagFromUrl(`${base}?other=1&${DEBUG_QUERY_PARAM}=on`)).toBe(true);
  });

  it("treats a bare parameter as on", () => {
    expect(debugFlagFromUrl(`https://x.test/p?${DEBUG_QUERY_PARAM}`)).toBe(true);
    expect(debugFlagFromUrl(`https://x.test/p?${DEBUG_QUERY_PARAM}=`)).toBe(true);
  });

  it("returns null when the parameter is absent, unrecognised, or the URL is unparseable", () => {
    expect(debugFlagFromUrl("https://x.test/p?other=1")).toBeNull();
    expect(debugFlagFromUrl("https://x.test/p")).toBeNull();
    expect(debugFlagFromUrl(`https://x.test/p?${DEBUG_QUERY_PARAM}=maybe`)).toBeNull();
    expect(debugFlagFromUrl("not a url")).toBeNull();
  });
});

describe("resolveDebugEnabled", () => {
  it("prefers the URL, then storage, then the build default", () => {
    expect(resolveDebugEnabled({ urlFlag: true, storageFlag: false, isDev: false })).toBe(true);
    expect(resolveDebugEnabled({ urlFlag: false, storageFlag: true, isDev: true })).toBe(false);
    expect(resolveDebugEnabled({ urlFlag: null, storageFlag: true, isDev: false })).toBe(true);
    expect(resolveDebugEnabled({ urlFlag: null, storageFlag: false, isDev: true })).toBe(false);
    expect(resolveDebugEnabled({ urlFlag: null, storageFlag: null, isDev: true })).toBe(true);
    expect(resolveDebugEnabled({ urlFlag: null, storageFlag: null, isDev: false })).toBe(false);
  });
});

describe("logging gate", () => {
  it("emits the [Cindieh] prefix only while enabled", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    disableDebug();
    expect(isDebugEnabled()).toBe(false);
    debugLog("a");
    debugWarn("b");
    debugError("c");
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    enableDebug();
    expect(isDebugEnabled()).toBe(true);
    debugLog("a", 1);
    debugWarn("b");
    debugError("c");
    expect(log).toHaveBeenCalledWith("[Cindieh]", "a", 1);
    expect(warn).toHaveBeenCalledWith("[Cindieh]", "b");
    expect(error).toHaveBeenCalledWith("[Cindieh]", "c");

    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("production opt-in hooks", () => {
  it("stays off in the test environment: no opt-in and NODE_ENV is not development", async () => {
    vi.resetModules();
    const fresh = await import("../content/debug");
    expect(fresh.isDebugEnabled()).toBe(false);
  });

  it("turns on from the URL when the build itself is not a dev build", async () => {
    vi.stubGlobal("location", { href: `https://x.test/p?${DEBUG_QUERY_PARAM}=1` });
    vi.resetModules();
    const fresh = await import("../content/debug");
    expect(fresh.isDebugEnabled()).toBe(true);
  });

  it("turns on from the stored flag, and the URL can override it back off", async () => {
    const store = new Map<string, string>([[DEBUG_STORAGE_KEY, "1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
    } as unknown as Storage);
    vi.resetModules();
    expect((await import("../content/debug")).isDebugEnabled()).toBe(true);

    vi.stubGlobal("location", { href: `https://x.test/p?${DEBUG_QUERY_PARAM}=0` });
    vi.resetModules();
    expect((await import("../content/debug")).isDebugEnabled()).toBe(false);
  });

  it("ignores a stale or unrecognised stored value", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "maybe",
    } as unknown as Storage);
    vi.resetModules();
    expect((await import("../content/debug")).isDebugEnabled()).toBe(false);
  });

  it("survives storage that throws (blocked or partitioned storage)", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    } as unknown as Storage);
    vi.resetModules();
    const fresh = await import("../content/debug");
    expect(fresh.isDebugEnabled()).toBe(false);
    expect(fresh.debugLog).toBeTypeOf("function");
  });
});
