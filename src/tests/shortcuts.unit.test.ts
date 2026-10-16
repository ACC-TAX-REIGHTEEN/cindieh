// Unit tests for shortcuts.ts — the page's only three keybindings.
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

// Mutable at test time because the panel key's page gate is its own predicate:
// the panel is not on every supported export page, so one test flips it. It is
// `isPanelPage` (either tab's gate) rather than either tab's own fact — the key
// opens the OVERLAY, which decides the tab.
let panelPage = true;
vi.mock("../content/page-context", () => ({
  isSupportedExportPage: () => true,
  isPanelPage: () => panelPage,
}));

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

/**
 * The custom events the handler dispatches, by type. Kept separate per type so
 * a test can tell "the module raised ch:scrape-stop" from "it raised
 * ch:scrape-toggle" — a fake that fires every registered handler regardless of
 * type would pass whichever one the module happened to send.
 */
let customEventListeners = new Map<string, EventListener[]>();

beforeEach(() => {
  postToScraper.mockClear();
  documentListeners = [];
  customEventListeners = new Map();
  panelPage = true;
  vi.stubGlobal("CustomEvent", class {
    type: string;
    constructor(type: string) { this.type = type; }
  });
  vi.stubGlobal("document", {
    addEventListener: (type: string, fn: EventListener) => {
      if (type === "keydown") {
        documentListeners.push(fn);
        return;
      }
      const list = customEventListeners.get(type) ?? [];
      list.push(fn);
      customEventListeners.set(type, list);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      if (type !== "keydown") return;
      documentListeners = documentListeners.filter((l) => l !== fn);
    },
    dispatchEvent: (event: Event) => {
      for (const fn of [...(customEventListeners.get(event.type) ?? [])]) fn(event);
      return true;
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("the declared shortcuts", () => {
  it("describes the three bindings, with the keys the handler actually tests", () => {
    // The table is documentation the handler reads. If the two ever drift the
    // README and the microsite describe a combination that does nothing.
    expect(SHORTCUTS.map((s) => s.combo)).toEqual([
      "Ctrl+Shift+E",
      "Ctrl+Shift+S",
      "Ctrl+Shift+B",
    ]);
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.description.length).toBeGreaterThan(10);
    }
    // Each id is unique, which is what SHORTCUT_BY_ID's Map lookup assumes.
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
  });

  it("describes the export key as the scrape it is, not as the menu it never opens", () => {
    // README, the microsite table and this description had all drifted into
    // promising the export MENU, which the key has never touched: it runs the
    // scrape (and is refused while a run is in flight, so it can never toggle
    // anything off either). One description, one guarantee.
    const exportKey = SHORTCUTS.find((s) => s.id === "export")!;
    expect(exportKey.description).toContain("scrape");
    expect(exportKey.description).not.toMatch(/menu|toggle/i);
  });
});

describe("registerShortcuts", () => {
  it("starts the scrape on Ctrl+Shift+E, in either case", () => {
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
    const stopped = vi.fn();
    document.addEventListener("ch:scrape-stop", stopped);

    for (const k of ["S", "s"]) {
      expect(press(k)).toBe(true);
      expect(stopped).toHaveBeenCalled();
    }

    // The event, not a direct STOP_SCRAPE: the isolated world has to settle its
    // own Run as well, and that half lives with the toolbar's stop path. Posting
    // from here left `isRunning()` true forever, because a cancelled run emits no
    // completion to clear it.
    expect(postToScraper).not.toHaveBeenCalled();
  });

  it("leaves the toggle alone when it stops, so a stop can never start a run", () => {
    registerShortcuts(() => true);
    const toggled = vi.fn();
    document.addEventListener("ch:scrape-toggle", toggled);

    press("S");

    expect(toggled).not.toHaveBeenCalled();
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

  // The panel key shares the toggle's dispatch path: it re-emits the same
  // ch:compare-open event the toolbar button sends, so the panel's own open
  // semantics (open once, close with Escape) stay single-sourced.
  it("opens the panel on Ctrl+Shift+B, in either case", () => {
    registerShortcuts(() => false);
    const opened = vi.fn();
    document.addEventListener("ch:compare-open", opened);

    for (const k of ["B", "b"]) {
      expect(press(k)).toBe(true);
      expect(opened).toHaveBeenCalled();
    }
    expect(postToScraper).not.toHaveBeenCalled();
  });

  it("answers nothing for the panel key outside the panel's pages", () => {
    // The panel's tabs exist on the four e-Faktur PPN grids alone (the check on
    // all four, the Komparator where a Referensi identifies a row); elsewhere
    // the key must leave the event to the portal.
    panelPage = false;
    registerShortcuts(() => false);
    const opened = vi.fn();
    document.addEventListener("ch:compare-open", opened);

    expect(press("B")).toBe(false);
    expect(opened).not.toHaveBeenCalled();
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
    expect(press("B")).toBe(false);
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