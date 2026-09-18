// Unit tests for scraper-nets.ts — the two BACKUP nets against duplicate
// native saves (P5 anchor clicks, P6 window.open). Extracted from the
// scraper.ts IIFE precisely so these corridors can be tested without a live
// browser; the primary block (response sabotage) is covered elsewhere.
//
// Contract under test: a net acts only while the session reports processing AND
// the call looks like the portal's own save corridor, it always self-resets
// after blocking, so at most one legitimate save/popup is swallowed per window,
// and an install/restore cycle must never leave a wrapper behind (ADR-0008).
//
// Known coverage limit (documented, not fixable here): the nets replace the
// `click` property and the `open` method only. A reference taken before
// install() — or `anchor.dispatchEvent(new MouseEvent("click"))` — bypasses
// them. The first case is locked below; the second needs a real DOM event
// dispatch, so it can only be observed on the live portal.
import { describe, it, expect, vi } from "vitest";
import {
  createDownloadNets,
  isBlobUrl,
  isPortalSaveAnchor,
  type AnchorClickTarget,
  type WindowOpenTarget,
} from "../content/scraper-nets";

const BLOB_URL = "blob:https://coretaxdjp.pajak.go.id/8f1c-4d2a";
const SAFE_URL = "https://coretaxdjp.pajak.go.id/e-invoice-portal/output-tax";

/** Session stub whose processing flag the tests can drive and observe. */
function makeSession(processing: boolean) {
  let state = processing;
  return {
    isProcessing: vi.fn(() => state),
    clearProcessing: vi.fn(() => {
      state = false;
    }),
    setProcessing: (value: boolean) => {
      state = value;
    },
  };
}

/** Anchor-prototype stub: records the receiver each click reaches it with. */
function makeAnchorPrototype() {
  const receivers: unknown[] = [];
  const proto: AnchorClickTarget = {
    click(this: HTMLAnchorElement): void {
      receivers.push(this);
    },
  };
  return { proto, receivers };
}

/** window stub: records arguments and returns a sentinel WindowProxy. */
function makeWindowTarget() {
  const calls: Array<{ url?: string | URL; target?: string; features?: string; receiver: unknown }> = [];
  const sentinel = { isWindowProxy: true } as unknown as WindowProxy;
  const win: WindowOpenTarget = {
    open(this: WindowOpenTarget, url?: string | URL, target?: string, features?: string): WindowProxy | null {
      calls.push({ url, target, features, receiver: this });
      return sentinel;
    },
  };
  return { win, calls, sentinel };
}

function makeNets(processing: boolean) {
  const session = makeSession(processing);
  const { proto, receivers } = makeAnchorPrototype();
  const { win, calls, sentinel } = makeWindowTarget();
  const log = vi.fn();
  const nets = createDownloadNets({
    session,
    anchorPrototype: proto,
    windowTarget: win,
    log,
  });
  return { nets, session, proto, receivers, win, calls, sentinel, log };
}

/** A plain object is enough: the nets only read `download` and `href`. */
function anchor(props: { download?: string; href?: string }): HTMLAnchorElement {
  return props as unknown as HTMLAnchorElement;
}

describe("isBlobUrl", () => {
  it("matches blob URLs in the string and URL forms window.open receives", () => {
    expect(isBlobUrl(BLOB_URL)).toBe(true);
    expect(isBlobUrl(new URL(BLOB_URL))).toBe(true);
  });

  it("is false for http(s), empty, and missing URLs", () => {
    expect(isBlobUrl(SAFE_URL)).toBe(false);
    expect(isBlobUrl("")).toBe(false);
    expect(isBlobUrl(undefined)).toBe(false);
    expect(isBlobUrl(null)).toBe(false);
  });

  it("stays case-sensitive, matching the browser-generated prefix", () => {
    expect(isBlobUrl("BLOB:https://x/1")).toBe(false);
  });
});

describe("isPortalSaveAnchor", () => {
  it("is true for a download attribute or a blob href", () => {
    expect(isPortalSaveAnchor({ download: "invoice.pdf", href: SAFE_URL })).toBe(true);
    expect(isPortalSaveAnchor({ download: "", href: BLOB_URL })).toBe(true);
  });

  it("is false for ordinary links", () => {
    expect(isPortalSaveAnchor({ href: SAFE_URL })).toBe(false);
    expect(isPortalSaveAnchor({})).toBe(false);
    expect(isPortalSaveAnchor({ download: "", href: "" })).toBe(false);
  });
});

describe("net 1 — anchor clicks", () => {
  it("blocks a download-attribute click while processing and self-resets", () => {
    const { nets, session, proto, receivers, log } = makeNets(true);
    nets.install();
    const save = anchor({ download: "invoice.pdf", href: SAFE_URL });

    proto.click.call(save);

    expect(receivers).toHaveLength(0); // the save never reached the browser
    expect(session.clearProcessing).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[Cindieh] Memblokir download klik bawaan.");

    // Self-reset: the 5s window is cut short, so a second (legitimate) click
    // passes through instead of being swallowed too (self-reset, not a window).
    proto.click.call(save);
    expect(receivers).toHaveLength(1);
    expect(session.clearProcessing).toHaveBeenCalledTimes(1);
  });

  it("blocks a blob-href click with no download attribute", () => {
    const { nets, proto, receivers, log } = makeNets(true);
    nets.install();

    proto.click.call(anchor({ href: BLOB_URL }));

    expect(receivers).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("forwards ordinary links while processing, keeping the real receiver", () => {
    const { nets, proto, receivers, session, log } = makeNets(true);
    nets.install();
    const link = anchor({ href: SAFE_URL });

    proto.click.call(link);

    expect(receivers).toEqual([link]);
    expect(session.clearProcessing).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("forwards saves when the session is not processing", () => {
    const { nets, proto, receivers, session } = makeNets(false);
    nets.install();

    proto.click.call(anchor({ download: "invoice.pdf", href: BLOB_URL }));

    expect(receivers).toHaveLength(1);
    expect(session.clearProcessing).not.toHaveBeenCalled();
  });

  it("lets an exception from the real click propagate untouched", () => {
    const { proto, receivers, win, log } = makeNets(true);
    const boom = new Error("click exploded");
    proto.click = function (this: HTMLAnchorElement): void {
      receivers.push(this);
      throw boom;
    };
    const nets = createDownloadNets({
      session: makeSession(true),
      anchorPrototype: proto,
      windowTarget: win,
      log,
    });
    nets.install();

    expect(() => proto.click.call(anchor({ href: SAFE_URL }))).toThrow(boom);
  });
});

describe("net 2 — window.open", () => {
  it("blocks a blob: popup while processing, returns null, and self-resets", () => {
    const { nets, win, calls, session, log } = makeNets(true);
    nets.install();

    expect(win.open(BLOB_URL, "_blank", "width=1")).toBeNull();
    expect(calls).toHaveLength(0); // the real open was never reached
    expect(session.clearProcessing).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[Cindieh] Memblokir window.open blob bawaan.");

    // Self-reset again: a second blob: popup is not swallowed as well.
    win.open(BLOB_URL);
    expect(calls).toHaveLength(1);
    expect(session.clearProcessing).toHaveBeenCalledTimes(1);
  });

  it("forwards non-blob popups while processing — the regression that narrowed this net", () => {
    const { nets, win, calls, sentinel, session, log } = makeNets(true);
    nets.install();

    const result = win.open(SAFE_URL, "_blank", "noopener");

    expect(result).toBe(sentinel);
    expect(calls).toEqual([{ url: SAFE_URL, target: "_blank", features: "noopener", receiver: win }]);
    expect(session.clearProcessing).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("forwards blob: popups when the session is not processing", () => {
    const { nets, win, calls, sentinel } = makeNets(false);
    nets.install();

    expect(win.open(BLOB_URL)).toBe(sentinel);
    expect(calls).toHaveLength(1);
  });

  it("forwards a call with no arguments", () => {
    const { nets, win, calls } = makeNets(true);
    nets.install();

    win.open();

    expect(calls).toEqual([{ url: undefined, target: undefined, features: undefined, receiver: win }]);
  });
});

describe("install / restore lifecycle", () => {
  it("installs and restores without leaving a wrapper behind (ADR-0008)", () => {
    const { nets, proto, win } = makeNets(false);
    const originalClick = proto.click;
    const originalOpen = win.open;

    nets.install();
    expect(proto.click).not.toBe(originalClick);
    expect(win.open).not.toBe(originalOpen);

    nets.restore();
    expect(proto.click).toBe(originalClick);
    expect(win.open).toBe(originalOpen);
  });

  it("is idempotent: a second install() does not stack a wrapper", () => {
    const { nets, proto, win } = makeNets(false);
    const originalClick = proto.click;
    const originalOpen = win.open;

    nets.install();
    const afterFirst = { click: proto.click, open: win.open };
    nets.install();

    expect(proto.click).toBe(afterFirst.click);
    expect(win.open).toBe(afterFirst.open);

    // The decisive check: restore() must still land on the ORIGINAL functions,
    // not on a wrapper — a stacked install would strand one on the prototype.
    nets.restore();
    expect(proto.click).toBe(originalClick);
    expect(win.open).toBe(originalOpen);
  });

  it("stops blocking after restore()", () => {
    const { nets, proto, receivers, session } = makeNets(true);
    nets.install();
    nets.restore();

    proto.click.call(anchor({ download: "invoice.pdf", href: SAFE_URL }));

    expect(receivers).toHaveLength(1);
    expect(session.clearProcessing).not.toHaveBeenCalled();
  });

  it("restore() before install() and a repeated restore() are no-ops", () => {
    const { nets, proto, win, receivers } = makeNets(true);
    const originalClick = proto.click;
    const originalOpen = win.open;

    nets.restore();
    expect(proto.click).toBe(originalClick);
    expect(win.open).toBe(originalOpen);

    nets.install();
    nets.restore();
    nets.restore();

    expect(proto.click).toBe(originalClick);
    expect(win.open).toBe(originalOpen);

    proto.click.call(anchor({ download: "x.pdf", href: SAFE_URL }));
    expect(receivers).toHaveLength(1);
  });

  it("can be installed again after a restore", () => {
    const { nets, proto, receivers } = makeNets(true);
    nets.install();
    nets.restore();
    nets.install();

    proto.click.call(anchor({ download: "invoice.pdf", href: SAFE_URL }));

    expect(receivers).toHaveLength(0);
  });

  it("covers only the two methods it patches, leaving the corridor unlocked for callers that cached a reference", () => {
    const { nets, proto, receivers, session } = makeNets(true);
    // A caller that grabbed the method BEFORE install keeps the un-patched
    // function; the net is best-effort by design and the primary sabotage is
    // what actually blocks the download.
    const cachedClick = proto.click;
    nets.install();

    cachedClick.call(anchor({ download: "invoice.pdf", href: SAFE_URL }));

    expect(receivers).toHaveLength(1);
    expect(session.clearProcessing).not.toHaveBeenCalled();
  });
});
