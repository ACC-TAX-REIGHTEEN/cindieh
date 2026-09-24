// Boot harness for scraper.ts — the last untested piece of the download path.
//
// The six patch bodies have their own suites (scraper-fetch, scraper-xhr-patches,
// scraper-nets), but until now nothing exercised the IIFE that wires them: which
// globals get patched, in what order, and whether teardown puts them all back.
// This file imports scraper.ts against a fake window/document/XHR/anchor so the
// boot itself is covered.
//
// The assertions are about wiring, not patch behaviour: the adapter hands the
// real prototypes to createXhrPatches/createDownloadNets, the bridge token
// reaches the injected script, the message dispatcher reaches the filter state,
// and pagehide restores every patched surface.
//
// Three patches are additionally driven end-to-end through the real prototypes
// here, because only this harness can prove the adapter handed the module the
// right target: P4 header recording, and P5/P6 blocking while armed (plus their
// pass-through and self-reset). The rest of the wiring is asserted structurally:
// each surface's reference must change on install and come back on teardown,
// which a wrong injected target cannot fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFakeDom, type FakeListener } from "./__mocks__/fake-dom";

const TOKEN = "test-bridge-token";
const PORTAL_ORIGIN = "https://coretaxdjp.pajak.go.id";
const PAGE_URL = `${PORTAL_ORIGIN}/e-invoice-portal/output-tax`;
const GRID_URL = `${PORTAL_ORIGIN}/einvoiceportal/api/outputinvoice/list`;
const DOWNLOAD_URL = `${PORTAL_ORIGIN}/einvoiceportal/api/DownloadInvoice/download-invoice-document`;
const PDF_BASE64 = "B".repeat(150);
const ROW = {
  TaxInvoiceNumber: "010.000-26.00000001",
  LetterNumber: "SZ-0447/07/26",
  BuyerName: "PT Contoh",
};

// ── Fake window / XHR / anchor ────────────────────────

interface BootWindow {
  location: { href: string; origin: string };
  fetch: (...args: unknown[]) => Promise<Response>;
  open: (...args: unknown[]) => unknown;
  postMessage(msg: Record<string, unknown>, origin?: string): void;
  addEventListener(type: string, fn: FakeListener): void;
  removeEventListener(type: string, fn: FakeListener): void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  scrollY: number;
  scrollX: number;
}

/** Structural view of a fake XHR, including the fields the patches add. */
interface FakeXhrLike {
  readyState: number;
  responseText: string;
  listenerTypes(): string[];
  fire(type: string): void;
  __downloadArmed?: boolean;
  __downloadBody?: string;
  /** Recorded by the P4 patch, then copied into the captured request. */
  __headers?: Record<string, string>;
}

/** Structural view of a fake anchor: the fields the P5 net inspects. */
interface FakeAnchorLike {
  href: string;
  download: string;
  click(): void;
}

function makeBootWindow(location: { href: string; origin: string }) {
  const listeners = new Map<string, FakeListener[]>();
  const messages: Array<Record<string, unknown>> = [];

  const win: BootWindow = {
    location,
    fetch: vi.fn(async () => new Response("{}", { status: 200 })) as unknown as BootWindow["fetch"],
    open: vi.fn(() => null),
    postMessage(msg) {
      messages.push(msg);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)?.push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx > -1) list.splice(idx, 1);
    },
    setTimeout,
    clearTimeout,
    scrollY: 0,
    scrollX: 0,
  };

  /** Invoke every listener for a type — how the harness fires pagehide/message. */
  const fire = (type: string, event?: unknown): void => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
  };

  return { win, messages, fire, listenerCount: (type: string) => listeners.get(type)?.length ?? 0 };
}

/** XHR double whose prototype methods are the "original" ones the boot replaces. */
function makeFakeXhrClass() {
  const instances: FakeXhrLike[] = [];
  const openCalls: Array<{ xhr: FakeXhrLike; args: unknown[] }> = [];
  const sendCalls: Array<{ xhr: FakeXhrLike; body: unknown }> = [];
  const headerCalls: Array<{ xhr: FakeXhrLike; args: unknown[] }> = [];

  class FakeXhr {
    readyState = 4;
    status = 200;
    responseText = "";
    private listeners = new Map<string, FakeListener[]>();

    constructor() {
      instances.push(this);
    }

    addEventListener(type: string, fn: FakeListener): void {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type)?.push(fn);
    }

    listenerTypes(): string[] {
      return [...this.listeners.keys()];
    }

    /** Fire an event like the browser would: listener called with the XHR as `this`. */
    fire(type: string): void {
      for (const fn of [...(this.listeners.get(type) ?? [])]) fn.call(this);
    }

    open(...args: unknown[]): void {
      openCalls.push({ xhr: this, args });
    }

    send(body?: unknown): void {
      sendCalls.push({ xhr: this, body });
    }

    setRequestHeader(...args: unknown[]): void {
      headerCalls.push({ xhr: this, args });
    }
  }

  return { FakeXhr, instances, openCalls, sendCalls, headerCalls };
}

function makeFakeAnchorClass() {
  const clicks: FakeAnchorLike[] = [];
  class FakeAnchor {
    // The net only blocks anchors that look like the portal's save corridor.
    href = "";
    download = "";
    click(): void {
      clicks.push(this);
    }
  }
  return { FakeAnchor, clicks };
}

// ── Boot ──────────────────────────────────────────────

async function bootScraper() {
  const { doc } = stubFakeDom();

  // Our own injected <script> marker: scraper.ts reads the bridge token from its
  // src query and then removes the attribute (ADR-0008).
  const script = doc.createElement("script");
  script.id = "__ch_scraper_injected__";
  script.src = `chrome-extension://abcdefghijklmnop/content/scraper.js?token=${TOKEN}&v=1.0.0`;
  doc.register(script);

  const location = { href: PAGE_URL, origin: PORTAL_ORIGIN };
  const { win, messages, fire, listenerCount } = makeBootWindow(location);
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", location);

  const xhr = makeFakeXhrClass();
  vi.stubGlobal("XMLHttpRequest", xhr.FakeXhr);
  const anchor = makeFakeAnchorClass();
  vi.stubGlobal("HTMLAnchorElement", anchor.FakeAnchor);

  const originals = {
    fetch: win.fetch,
    open: xhr.FakeXhr.prototype.open,
    send: xhr.FakeXhr.prototype.send,
    setRequestHeader: xhr.FakeXhr.prototype.setRequestHeader,
    anchorClick: anchor.FakeAnchor.prototype.click,
    windowOpen: win.open,
  };

  vi.resetModules();
  await import("../content/scraper");

  const callOpen = (target: object, url: string): void => {
    (xhr.FakeXhr.prototype.open as (...a: unknown[]) => unknown).call(target, "POST", url, true);
  };
  const callSend = (target: object, body?: unknown): void => {
    (xhr.FakeXhr.prototype.send as (...a: unknown[]) => unknown).call(target, body);
  };
  const callSetHeader = (target: object, name: string, value: string): void => {
    (xhr.FakeXhr.prototype.setRequestHeader as (...a: unknown[]) => unknown).call(target, name, value);
  };

  return {
    doc,
    script,
    location,
    win,
    messages,
    fire,
    listenerCount,
    ...xhr,
    ...anchor,
    originals,
    callOpen,
    callSend,
    callSetHeader,
    /** Deliver a FROM_CONTENT message exactly as the isolated world would. */
    dispatchFromContent(data: Record<string, unknown>): void {
      fire("message", {
        source: win,
        origin: PORTAL_ORIGIN,
        data: { ...data, direction: "FROM_CONTENT", token: TOKEN },
      });
    },
  };
}

/** Boot with no injected marker element, to cover the token-less path. */
async function bootWithoutMarker() {
  const { doc } = stubFakeDom();
  const location = { href: PAGE_URL, origin: PORTAL_ORIGIN };
  const { win, messages } = makeBootWindow(location);
  vi.stubGlobal("window", win);
  vi.stubGlobal("location", location);
  vi.stubGlobal("XMLHttpRequest", makeFakeXhrClass().FakeXhr);
  vi.stubGlobal("HTMLAnchorElement", makeFakeAnchorClass().FakeAnchor);

  vi.resetModules();
  await import("../content/scraper");

  return { doc, messages };
}

/** The filter entries of the most recent grid request the page sent. */
function sentFilters(env: Awaited<ReturnType<typeof bootScraper>>): Record<string, unknown>[] {
  const body = JSON.parse(String(env.sendCalls.at(-1)?.body)) as { filters?: Record<string, unknown>[] };
  return body.filters ?? [];
}

beforeEach(() => {
  // The PDF session arms a 5s auto-reset timer; keep it inert.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});

// ── Installation ──────────────────────────────────────

describe("scraper boot — patch installation", () => {
  it("patches all six surfaces the download path depends on", async () => {
    const env = await bootScraper();

    expect(env.win.fetch).not.toBe(env.originals.fetch); // P1
    expect(env.FakeXhr.prototype.open).not.toBe(env.originals.open); // P2
    expect(env.FakeXhr.prototype.send).not.toBe(env.originals.send); // P3
    expect(env.FakeXhr.prototype.setRequestHeader).not.toBe(env.originals.setRequestHeader); // P4
    expect(env.FakeAnchor.prototype.click).not.toBe(env.originals.anchorClick); // P5
    expect(env.win.open).not.toBe(env.originals.windowOpen); // P6
  });

  it("registers its message and teardown listeners exactly once", async () => {
    const env = await bootScraper();

    expect(env.listenerCount("message")).toBe(1);
    expect(env.listenerCount("pagehide")).toBe(1);
  });

  it("delegates a non-download fetch straight to the original", async () => {
    const env = await bootScraper();

    await env.win.fetch(GRID_URL);

    expect(env.originals.fetch).toHaveBeenCalledTimes(1);
  });

  it("signals readiness with the bridge token read from its own script src", async () => {
    const env = await bootScraper();

    expect(env.messages.find((m) => m.type === "INJECTED_READY")).toMatchObject({
      direction: "FROM_PAGE",
      token: TOKEN,
    });
  });

  it("consumes the script src but keeps the element as the injection marker (ADR-0008)", async () => {
    const env = await bootScraper();

    expect(env.script.src).toBe("");
    expect(env.doc.getElementById("__ch_scraper_injected__")).toBe(env.script);
  });

  it("stays bootable without the marker element, just without a token", async () => {
    const env = await bootWithoutMarker();

    expect(env.doc.getElementById("__ch_scraper_injected__")).toBeNull();
    expect(env.messages.find((m) => m.type === "INJECTED_READY")).toMatchObject({ token: "" });
  });
});

// ── Wiring through the real prototypes ────────────────

describe("scraper boot — wiring through the real prototypes", () => {
  it("wires the download response reader at open(), and only for the download endpoint", async () => {
    const env = await bootScraper();

    const download = new env.FakeXhr();
    env.callOpen(download, DOWNLOAD_URL);
    expect(download.listenerTypes()).toEqual(["readystatechange"]);

    const grid = new env.FakeXhr();
    env.callOpen(grid, GRID_URL);
    expect(grid.listenerTypes()).toEqual([]);
  });

  it("applies a filter sent over the bridge to the next grid request", async () => {
    const env = await bootScraper();

    env.dispatchFromContent({ type: "SET_SERVER_FILTER", field: "Reference", value: "SZ-0447/07/26" });
    const grid = new env.FakeXhr();
    env.callOpen(grid, GRID_URL);
    env.callSend(grid, JSON.stringify({ First: 0, Rows: 10 }));

    const sent = JSON.parse(String(env.sendCalls.at(-1)?.body)) as { filters: Record<string, unknown>[] };
    expect(sent.filters).toEqual([
      {
        PropertyName: "Reference",
        Value: "SZ-0447/07/26",
        MatchMode: "contains",
        CaseSensitive: false,
        AsString: false,
      },
    ]);
  });

  it("widens an empty reference prefix search to contains and asks for a retry", async () => {
    const env = await bootScraper();

    env.dispatchFromContent({
      type: "SET_SERVER_FILTER",
      field: "Reference",
      value: "EE-0300",
      matchMode: "startswith",
    });

    // First search: the fast prefix mode, and the server found nothing.
    const first = new env.FakeXhr();
    env.callOpen(first, GRID_URL);
    env.callSend(first, JSON.stringify({ First: 0, Rows: 10 }));
    first.responseText = JSON.stringify({ Payload: { Data: [] } });
    first.fire("load");

    expect(sentFilters(env)[0]).toMatchObject({
      PropertyName: "Reference",
      Value: "EE-0300",
      MatchMode: "startswith",
    });
    expect(env.messages.find((m) => m.type === "REFERENCE_FILTER_FALLBACK")).toMatchObject({
      value: "EE-0300",
      direction: "FROM_PAGE",
      token: TOKEN,
    });

    // The retry the content script is about to click already carries the wide
    // mode — the scraper flips the filter before it asks for the click.
    const retry = new env.FakeXhr();
    env.callOpen(retry, GRID_URL);
    env.callSend(retry, JSON.stringify({ First: 0, Rows: 10 }));
    expect(sentFilters(env)[0]).toMatchObject({ MatchMode: "contains" });
  });

  it("widens a reference search at most once, and never when rows came back", async () => {
    const env = await bootScraper();
    env.dispatchFromContent({
      type: "SET_SERVER_FILTER",
      field: "Reference",
      value: "EE-0300",
      matchMode: "startswith",
    });

    const capture = (data: unknown[]): void => {
      const grid = new env.FakeXhr();
      env.callOpen(grid, GRID_URL);
      env.callSend(grid, JSON.stringify({ First: 0, Rows: 10 }));
      grid.responseText = JSON.stringify({ Payload: { Data: data } });
      grid.fire("load");
    };

    capture([ROW]); // the prefix match was enough
    expect(env.messages.filter((m) => m.type === "REFERENCE_FILTER_FALLBACK")).toHaveLength(0);

    capture([]); // empty → widen (one-shot)
    capture([]); // still empty with contains → no second retry
    expect(env.messages.filter((m) => m.type === "REFERENCE_FILTER_FALLBACK")).toHaveLength(1);
  });

  it("still rejects a filter message with the wrong direction", async () => {
    const env = await bootScraper();

    env.fire("message", {
      source: env.win,
      origin: PORTAL_ORIGIN,
      data: { type: "SET_SERVER_FILTER", field: "Reference", value: "spoofed", direction: "FROM_PAGE", token: TOKEN },
    });
    const grid = new env.FakeXhr();
    env.callOpen(grid, GRID_URL);
    env.callSend(grid, JSON.stringify({ First: 0, Rows: 10 }));

    const sent = JSON.parse(String(env.sendCalls.at(-1)?.body)) as { filters?: unknown[] };
    expect(sent.filters).toEqual([]);
  });

  it("records request headers on the XHR and still forwards them (P4)", async () => {
    const env = await bootScraper();

    const grid = new env.FakeXhr();
    env.callOpen(grid, GRID_URL);
    env.callSetHeader(grid, "Authorization", "Bearer token");
    env.callSetHeader(grid, "X-Custom", "1");

    // Forwarded: the portal's own headers still reach the network.
    expect(env.headerCalls.map((c) => c.args)).toEqual([
      ["Authorization", "Bearer token"],
      ["X-Custom", "1"],
    ]);
    // Recorded on the instance, which send() copies into the captured request.
    expect((grid as unknown as FakeXhrLike).__headers).toEqual({
      Authorization: "Bearer token",
      "X-Custom": "1",
    });
    // open() clears them, so a reused XHR never carries a stale header set.
    env.callOpen(grid, GRID_URL);
    expect((grid as unknown as FakeXhrLike).__headers).toEqual({});
  });

  it("carries a captured row into the emitted PDF item, and hands the portal the sabotage dummy", async () => {
    const env = await bootScraper();

    // 1. Capture a grid response.
    const grid = new env.FakeXhr();
    env.callOpen(grid, GRID_URL);
    env.callSend(grid, JSON.stringify({ First: 0, Rows: 10 }));
    grid.responseText = JSON.stringify({ Payload: { Data: [ROW] } });
    grid.fire("load");

    // 2. A native 1-click download for one of those rows.
    const download = new env.FakeXhr();
    env.callOpen(download, DOWNLOAD_URL);
    env.callSend(download, JSON.stringify({ TaxInvoiceNumber: ROW.TaxInvoiceNumber }));
    download.responseText = JSON.stringify({ IsSuccessful: true, Content: PDF_BASE64 });
    download.fire("readystatechange");

    const emitted = env.messages.find((m) => m.type === "DOWNLOAD_PDF_ITEM");
    expect(emitted).toBeDefined();
    expect(emitted?.base64).toBe(PDF_BASE64);
    expect(emitted?.source).toBe("OUTPUT_TAX");
    // Item metadata resolved through the row map the capture populated.
    expect(emitted?.item).toMatchObject({ BuyerName: "PT Contoh", LetterNumber: ROW.LetterNumber });
    // The portal is left reading the failure payload, not the PDF.
    expect(download.responseText).toBe(JSON.stringify({ IsSuccessful: false, Content: "" }));
  });

  it("names nothing when a download arrives with no capture behind it", async () => {
    const env = await bootScraper();

    const download = new env.FakeXhr();
    env.callOpen(download, DOWNLOAD_URL);
    env.callSend(download, JSON.stringify({ TaxInvoiceNumber: ROW.TaxInvoiceNumber }));
    download.responseText = JSON.stringify({ Content: PDF_BASE64 });
    download.fire("readystatechange");

    expect(env.messages.find((m) => m.type === "DOWNLOAD_PDF_ITEM")?.item).toEqual({});
  });
});

// ── Backup nets through the real prototypes ───────────

describe("scraper boot — backup nets while armed", () => {
  /** Open the 5s processing window the nets check, via a native 1-click download. */
  const arm = (env: Awaited<ReturnType<typeof bootScraper>>): void => {
    const download = new env.FakeXhr();
    env.callOpen(download, DOWNLOAD_URL);
    env.callSend(download, JSON.stringify({ TaxInvoiceNumber: ROW.TaxInvoiceNumber }));
  };

  it("blocks the blob-anchor save corridor while armed, then self-resets (P5)", async () => {
    const env = await bootScraper();
    arm(env);

    // An ordinary link is the user's, not the portal's save corridor.
    const ordinary = new env.FakeAnchor();
    ordinary.href = "https://example.com/help";
    ordinary.click();
    expect(env.clicks).toEqual([ordinary]);

    // The portal's own save: blob href → swallowed before the real click.
    const save = new env.FakeAnchor();
    save.href = "blob:https://coretaxdjp.pajak.go.id/xyz";
    save.click();
    expect(env.clicks).toEqual([ordinary]);

    // Self-reset: the net blocks at most one save, so the next click is real.
    save.click();
    expect(env.clicks).toEqual([ordinary, save]);
  });

  it("forwards a non-blob popup while armed, and blocks a blob one (P6)", async () => {
    const env = await bootScraper();
    arm(env);

    env.win.open("https://example.com/help", "_blank", "width=400");
    expect(env.originals.windowOpen).toHaveBeenCalledWith(
      "https://example.com/help",
      "_blank",
      "width=400",
    );

    // Still armed — the pass-through above must not have consumed the window.
    expect(env.win.open("blob:https://coretaxdjp.pajak.go.id/xyz")).toBeNull();
    expect(env.originals.windowOpen).toHaveBeenCalledTimes(1);

    // Self-reset: the next blob open reaches the real window.
    env.win.open("blob:https://coretaxdjp.pajak.go.id/xyz");
    expect(env.originals.windowOpen).toHaveBeenCalledTimes(2);
  });
});

// ── Teardown ──────────────────────────────────────────

describe("scraper boot — teardown", () => {
  it("restores every patched surface on pagehide", async () => {
    const env = await bootScraper();

    env.fire("pagehide");

    expect(env.win.fetch).toBe(env.originals.fetch);
    expect(env.FakeXhr.prototype.open).toBe(env.originals.open);
    expect(env.FakeXhr.prototype.send).toBe(env.originals.send);
    expect(env.FakeXhr.prototype.setRequestHeader).toBe(env.originals.setRequestHeader);
    expect(env.FakeAnchor.prototype.click).toBe(env.originals.anchorClick);
    expect(env.win.open).toBe(env.originals.windowOpen);
  });

  it("stops intercepting downloads after teardown", async () => {
    const env = await bootScraper();
    env.fire("pagehide");

    const download = new env.FakeXhr();
    env.callOpen(download, DOWNLOAD_URL);
    env.callSend(download, JSON.stringify({ TaxInvoiceNumber: ROW.TaxInvoiceNumber }));

    expect(download.listenerTypes()).toEqual([]); // no response reader wired
    expect((download as unknown as FakeXhrLike).__downloadArmed).toBeUndefined();
  });

  it("still restores the other surfaces when one restore is refused", async () => {
    const env = await bootScraper();

    // Simulate the portal making a patched method non-writable after our patch:
    // the restore assignment for P4 throws, part-way through the XHR restore.
    Object.defineProperty(env.FakeXhr.prototype, "setRequestHeader", {
      configurable: true,
      get: () => env.originals.setRequestHeader,
      set: () => {
        throw new Error("refused");
      },
    });

    env.fire("pagehide");

    // P2/P3 were restored before the refusal; P1 and both nets must not be
    // stranded behind it for the rest of the page's life.
    expect(env.FakeXhr.prototype.open).toBe(env.originals.open);
    expect(env.FakeXhr.prototype.send).toBe(env.originals.send);
    expect(env.FakeAnchor.prototype.click).toBe(env.originals.anchorClick);
    expect(env.win.open).toBe(env.originals.windowOpen);
    expect(env.win.fetch).toBe(env.originals.fetch);
  });

  it("lets a fresh boot re-patch cleanly after a teardown", async () => {
    const first = await bootScraper();
    const firstPatches = {
      open: first.FakeXhr.prototype.open,
      send: first.FakeXhr.prototype.send,
      fetch: first.win.fetch,
    };

    first.fire("pagehide");
    expect(first.FakeXhr.prototype.open).toBe(first.originals.open);

    const second = await bootScraper();

    // The second boot patches its own surfaces; the first boot's are restored.
    expect(second.FakeXhr.prototype.open).not.toBe(firstPatches.open);
    expect(second.FakeXhr.prototype.open).not.toBe(first.originals.open);
    expect(first.FakeXhr.prototype.send).toBe(first.originals.send);
    expect(first.win.fetch).toBe(first.originals.fetch);
  });
});
