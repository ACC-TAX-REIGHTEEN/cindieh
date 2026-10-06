// Unit tests for shortcuts.ts — the page's only two keybindings.
//
// These existed as untested code for the life of the feature (the module sat at
// 5% coverage and AGENTS.md named it as a known gap). What the tests pin is not
// the keystrokes themselves but the four decisions around them: the page must
// be a supported export page, a switched-off extension must answer nothing, the
// export key is refused while a run is in flight, and the unregister must
// actually remove the listener — a `document` listener that outlives the
// toolbar is the half-removed state teardownInjectedUi() exists to prevent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerShortcuts, SHORTCUTS } from "../content/shortcuts";

const postToScraper = vi.hoisted(() => vi.fn());
vi.mock("../content/bridge", () => ({ postToScraper }));
vi.mock("../content/page-context", () => ({ isSupportedExportPage: () => true }));

/** One keydown, shaped the way the handler reads it. */
function key(key: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: true,
    shiftKey: true,
    metaKey: false,
    preventDefault: vi.fn(),
    ...extra,
  } as unknown as KeyboardEvent;
}

/** Press a combination on the document and report whether it was consumed. */
function press(k: string, extra: Partial<KeyboardEvent> = {}): boolean {
  const event = key(k, extra);
  for (const listener of documentListeners) listener(event);
  return vi.mocked(event.preventDefault).mock.calls.length > 0;
}

// Captured at registration time, so replacing the array still drives the
// already-installed listener the way a real DOM would.
let documentListeners: EventListener[] = [];
let scrapToggle: EventListener[] = [];

beforeEach(() => {
  postToScraper.mockClear();
  documentListeners = [];
  scrapToggle = [];
  vi.stubGlobal("CustomEvent", class {
    type: string;
    constructor(type: string) { this.type = type; }
  });
  vi.stubGlobal("document", {
    addEventListener: (type: string, fn: EventListener) => {
      if (type === "keydown") documentListeners.push(fn);
      if (type === "ch:scrape-toggle") scrapToggle.push(fn);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      if (type !== "keydown") return;
      documentListeners = documentListeners.filter((l) => l !== fn);
    },
    dispatchEvent: (event: Event) => {
      for (const fn of scrapToggle) fn(event);
      return true;
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("the declared shortcuts", () => {
  it("describes both bindings, with the keys the handler actually tests", () => {
    // The table is documentation the handler reads. If the two ever drift the
    // README and the microsite describe a combination that does nothing.
    expect(SHORTCUTS.map((s) => s.combo)).toEqual(["Ctrl+Shift+E", "Ctrl+Shift+S"]);
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.description.length).toBeGreaterThan(10);
    }
    // Each id is unique, which is what SHORTCUT_BY_ID's Map lookup assumes.
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });
});

describe("registerShortcuts", () => {
  it("starts an export on Ctrl+Shift+E, in either case", () => {
    registerShortcuts(() => false);
    const toggled = vi.fn();
    document.addEventListener("ch:scrape-toggle", toggled);

    for (const k of ["E", "e"]) {
      expect(press(k)).toBe(true);
      expect(toggled).toHaveBeenCalled();
    }
    expect(postToScraper).not.toHaveBeenCalled();
  });

  it("stops a running export on Ctrl+Shift+S, in either case", () => {
    registerShortcuts(() => true);

    for (const k of ["S", "s"]) {
      expect(press(k)).toBe(true);
      expect(postToScraper).toHaveBeenCalledWith({ type: "STOP_SCRAPE" });
    }
  });

  it("never starts a second export while one is running", () => {
    // The double-export is the failure this guard exists for: two runs racing
    // for the same grid, and a completion message for the one nobody sees.
    registerShortcuts(() => true);
    const toggled = vi.fn();
    document.addEventListener("ch:scrape-toggle", toggled);

    expect(press("E")).toBe(false);
    expect(toggled).not.toHaveBeenCalled();
  });

  it("never sends a stop when nothing is running", () => {
    registerShortcuts(() => false);
    expect(press("S")).toBe(false);
    expect(postToScraper).not.toHaveBeenCalled();
  });

  it("requires the modifier, and leaves the event to the portal without it", () => {
    registerShortcuts(() => false);
    const toggled = vi.fn();
    document.addEventListener("ch:scrape-toggle", toggled);

    // Not consuming the event is the half that matters: the portal has its own
    // keyboard handling, and swallowing Ctrl+Shift+E there would be a bug.
    for (const modifier of [{ ctrlKey: false, metaKey: false }, { ctrlKey: true, shiftKey: false }]) {
      expect(press("E", modifier)).toBe(false);
    }
    expect(toggled).not.toHaveBeenCalled();
  });

  it("ignores an unrelated key even with the modifiers held", () => {
    registerShortcuts(() => true);
    expect(press("K")).toBe(false);
    expect(postToScraper).not.toHaveBeenCalled();
  });

  it("answers nothing at all once the extension is switched off", () => {
    // A shortcut for a disabled extension is not a shortcut. Without this the
    // master switch would remove every control and leave Ctrl+Shift+E still
    // starting a run.
    registerShortcuts(() => false, () => false);

    expect(press("E")).toBe(false);
    expect(press("S")).toBe(false);
    expect(postToScraper).not.toHaveBeenCalled();
  });

  it("stops answering once unregistered", () => {
    const unregister = registerShortcuts(() => false);
    expect(documentListeners).toHaveLength(1);

    unregister();

    expect(documentListeners).toHaveLength(0);
    expect(press("E")).toBe(false);
  });

  it("can be unregistered twice without throwing", () => {
    // applyPageState() runs on every SPA navigation, so a teardown that lands
    // twice — or a re-enable that lands twice — must not throw.
    const unregister = registerShortcuts(() => false);
    unregister();
    expect(() => unregister()).not.toThrow();
  });

  it("never leaves two listeners behind", () => {
    const first = registerShortcuts(() => false);
    const second = registerShortcuts(() => false);
    first();

    // Two listeners would make one Ctrl+Shift+E toggle twice, i.e. not at all.
    expect(documentListeners).toHaveLength(1);
    const toggled = vi.fn();
    document.addEventListener("ch:scrape-toggle", toggled);
    press("E");
    expect(toggled).toHaveBeenCalledTimes(1);
    second();
  });
});

describe("registerShortcuts on an unsupported page", () => {
  // The handler asks page-context every press, so the mock is re-armed per case.
  it("does nothing on a page the extension does not support", async () => {
    vi.resetModules();
    vi.doMock("../content/page-context", () => ({ isSupportedExportPage: () => false }));
    const { registerShortcuts: register } = await import("../content/shortcuts");

    register(() => false);

    expect(press("E")).toBe(false);
    expect(press("S")).toBe(false);
    vi.doUnmock("../content/page-context");
  });
});