// ============================================================
// SCRAPER-INSTALL.UNIT.TEST.TS — the MAIN world's install wiring
// ============================================================
// scraper.ts used to be one IIFE that read six globals directly, so
// none of the decisions inside it could be driven: which messages this
// RUN accepts, what a missing captured request is told, whether the
// token survived the script's src being stripped, and whether one
// refused restore strands the others (ADR-0038).
//
// This suite installs the scraper over an ENV — one object holding the
// page's handles — and drives those decisions directly. The real
// prototypes are still exercised by scraper-boot.unit.test.ts, which
// imports the adapter and asserts the wiring reached the browser.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFakeDom, type FakeDoc, type FakeListener } from "./__mocks__/fake-dom";
import { installScraper, type ScraperEnv } from "../content/scraper-install";
import type { MessageEventLike } from "../content/postmessage-guard";

const TOKEN = "bridge-token-1";
const ORIGIN = "https://coretaxdjp.pajak.go.id";
const PAGE = `${ORIGIN}/e-invoice-portal/output-tax`;

/** A fake window: the guard's source reference, the channel, the timers. */
function makeWindow() {
  const listeners = new Map<string, FakeListener[]>();
  const messages: Array<Record<string, unknown>> = [];
  const fetch = vi.fn(async () => new Response("{}", { status: 200 }));

  const win = {
    location: { href: PAGE, origin: ORIGIN },
    fetch: fetch as unknown as typeof globalThis.fetch,
    open: vi.fn(() => null),
    postMessage(message: Record<string, unknown>) {
      messages.push(message);
    },
    addEventListener(type: string, listener: FakeListener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)?.push(listener);
    },
  };

  const fire = (type: string, event?: unknown): void => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
  };

  return { win, messages, fire };
}

/** A prototype whose `open`/`send` are the "original" ones a patch replaces. */
function makeXhrPrototype() {
  class FakeXhr {
    open(): void {}
    send(): void {}
    setRequestHeader(): void {}
  }
  return FakeXhr.prototype;
}

/** The anchor prototype the blob-save net patches. */
function makeAnchorPrototype() {
  class FakeAnchor {
    click(): void {}
  }
  return FakeAnchor.prototype;
}

describe("the MAIN world's install wiring", () => {
  let doc: FakeDoc;
  let win: ReturnType<typeof makeWindow>["win"];
  let messages: ReturnType<typeof makeWindow>["messages"];
  let fire: ReturnType<typeof makeWindow>["fire"];
  let env: ScraperEnv;
  let xhrPrototype: ReturnType<typeof makeXhrPrototype>;
  let anchorPrototype: ReturnType<typeof makeAnchorPrototype>;
  /** The fetch the installer put on the page, as the adapter would. */
  let installedFetch: typeof globalThis.fetch;
  let setFetchCalls: number;

  /** Put the injected script — with its token in the URL — in the document. */
  function mountTokenScript(src = `${ORIGIN}/content/scraper.js?token=${TOKEN}`): void {
    const script = doc.createElement("script");
    script.id = "__ch_scraper_injected__";
    script.src = src;
    doc.register(script);
    doc.head.appendChild(script);
  }

  /** Send one cross-world message, the way the content script does. */
  function send(data: Record<string, unknown>): void {
    fire("message", { source: win, origin: ORIGIN, data: { direction: "FROM_CONTENT", token: TOKEN, ...data } });
  }

  beforeEach(() => {
    doc = stubFakeDom().doc;
    mountTokenScript();
    const page = makeWindow();
    win = page.win;
    messages = page.messages;
    fire = page.fire;
    xhrPrototype = makeXhrPrototype();
    anchorPrototype = makeAnchorPrototype();
    setFetchCalls = 0;
    installedFetch = win.fetch;

    env = {
      document: doc as unknown as Document,
      window: win as unknown as ScraperEnv["window"],
      setFetch: (next) => {
        setFetchCalls += 1;
        installedFetch = next;
        (win as { fetch: unknown }).fetch = next;
      },
      xhrPrototype: xhrPrototype as unknown as XMLHttpRequest,
      anchorPrototype: anchorPrototype as unknown as HTMLAnchorElement,
      isDevelopment: false,
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("announces itself ready, carrying the token it read off its own script", () => {
    installScraper(env);

    const ready = messages.find((msg) => msg.type === "INJECTED_READY");
    expect(ready).toMatchObject({ type: "INJECTED_READY", direction: "FROM_PAGE", token: TOKEN });
    // The element stays as the one-time injection marker (ADR-0008); only its
    // src goes, which is what stops the token sitting in the DOM.
    expect(doc.getElementById("__ch_scraper_injected__")!.src).toBe("");
  });

  it("drops a message that does not carry this bridge's token", () => {
    installScraper(env);
    messages.length = 0;

    fire("message", {
      source: win,
      origin: ORIGIN,
      data: { direction: "FROM_CONTENT", token: "someone-else", type: "STOP_SCRAPE" },
    });

    // Nothing is announced back, and no handler ran: an unauthenticated sender
    // cannot reach the action table at all.
    expect(messages).toEqual([]);
  });

  it("ignores a message posted from another origin", () => {
    // The guard's other half: the token alone is not enough, the message has to
    // come from this page. (Same-page scripts can read the token, ADR-0007.)
    installScraper(env);
    messages.length = 0;

    fire("message", {
      source: win,
      origin: "https://evil.example",
      data: { direction: "FROM_CONTENT", token: TOKEN, type: "STOP_SCRAPE" },
    });

    expect(messages).toEqual([]);
  });

  it("starts no action for a run that names no usable id", async () => {
    // A runId is the handle every later message is matched against; an action
    // started without one could never be settled, so it is refused at the door
    // rather than run and abandoned.
    installScraper(env);
    messages.length = 0;

    send({ type: "START_SCRAPE", runId: 0 });
    send({ type: "START_SCRAPE" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(messages).toEqual([]);
  });

  it("survives a navigation reset with nothing in flight", () => {
    // main.ts posts RESET_SCRAPER on every SPA navigation, including ones where
    // no run ever started; the page must be able to start one afterwards.
    installScraper(env);

    expect(() => send({ type: "RESET_SCRAPER" })).not.toThrow();

    messages.length = 0;
    send({ type: "START_PDF_DOWNLOAD", runId: 5, data: [] });
    expect(messages[0]).toMatchObject({ type: "SCRAPE_ERROR", runId: 5 });
  });

  it("tells the caller which run owed a download it has no request for", () => {
    // A bulk PDF needs the grid request captured first; without one the run is
    // answered instead of being left to wait for a completion that cannot come.
    installScraper(env);
    messages.length = 0;

    send({ type: "START_PDF_DOWNLOAD", runId: 42, data: [] });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "SCRAPE_ERROR", runId: 42, direction: "FROM_PAGE" });
    expect(String(messages[0].message)).toContain("Tidak ada data request yang tersimpan");
  });

  it("patches the page through the handles it was given", () => {
    const originalFetch = win.fetch;
    const originalOpen = xhrPrototype.open;

    installScraper(env);

    expect(win.fetch).not.toBe(originalFetch);
    expect(xhrPrototype.open).not.toBe(originalOpen);
    expect(setFetchCalls).toBe(1);
  });

  it("restores every patched surface on pagehide", () => {
    const originalFetch = win.fetch;
    const originalOpen = xhrPrototype.open;
    const originalClick = anchorPrototype.click;

    installScraper(env);
    fire("pagehide");

    expect(win.fetch).toBe(originalFetch);
    expect(installedFetch).toBe(originalFetch);
    expect(xhrPrototype.open).toBe(originalOpen);
    expect(anchorPrototype.click).toBe(originalClick);
  });

  it("keeps restoring when one of the surfaces refuses to go back", () => {
    // The portal can redefine a prototype method as non-writable after we
    // patch it. One refused restore must not strand the other two for the rest
    // of the page's life.
    const originalOpen = xhrPrototype.open;
    const originalClick = anchorPrototype.click;
    const originalFetch = win.fetch;

    installScraper(env);
    // The page now refuses the fetch restore, the way a non-writable property
    // would; the other two restores must still happen.
    env.setFetch = () => {
      throw new Error("redefined");
    };

    expect(() => fire("pagehide")).not.toThrow();

    expect(xhrPrototype.open).toBe(originalOpen);
    expect(anchorPrototype.click).toBe(originalClick);
    // The refused one is the only surface left patched — and a later teardown
    // with a working target finishes the job.
    expect((win as { fetch: unknown }).fetch).not.toBe(originalFetch);
    env.setFetch = (next) => {
      (win as { fetch: unknown }).fetch = next;
    };
    fire("pagehide");
    expect((win as { fetch: unknown }).fetch).toBe(originalFetch);
  });

  it("exposes the debug hook only in a development build", () => {
    installScraper(env);
    expect((win as Record<string, unknown>).__scraperSendToContent).toBeUndefined();

    const devDoc = stubFakeDom().doc;
    const dev = makeWindow();
    installScraper({ ...env, document: devDoc as unknown as Document, window: dev.win as never, isDevelopment: true });

    expect(typeof (dev.win as Record<string, unknown>).__scraperSendToContent).toBe("function");
  });

  it("returns a teardown that is safe to call on its own", () => {
    const originalOpen = xhrPrototype.open;
    const installed = installScraper(env);

    installed.teardown();
    expect(xhrPrototype.open).toBe(originalOpen);

    // A second call after the browser already restored everything is not an
    // error: teardown is also reachable from the pagehide listener.
    expect(() => installed.teardown()).not.toThrow();
  });

  it("accepts a message the guard can attribute to this page", () => {
    // The sanity half of the token case: a message that IS ours reaches the
    // handlers, so the rejection above is the token and not the transport.
    installScraper(env);
    messages.length = 0;

    send({ type: "START_PDF_DOWNLOAD", runId: 7, data: [] });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "SCRAPE_ERROR", runId: 7 });
  });
});

/** Keep the type import honest: the events this suite fires are the guard's shape. */
const _eventShape: MessageEventLike = { source: null, origin: "", data: null };
void _eventShape;
