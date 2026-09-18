// Boot tests for popup.ts — the last extension context without coverage of its
// own wiring.
//
// The popup is small but it owns two shared state keys: the export mode the
// content script reads, and the debug switch the whole extension reads. What is
// worth pinning is that the controls reflect stored state on open, that changing
// them persists (never just repaints), and that the debug toggle applies to the
// popup's own logger immediately — otherwise a switch that looks on would do
// nothing until some other context restarted.
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubFakeDom, type FakeEl } from "./__mocks__/fake-dom";

const EXPORT_MODE_KEY = "cindiehExportMode";
const DEBUG_KEY = "cindieh:debug";

/** Minimal browser.storage.local double, plus a record of what was written. */
function makeFakeBrowser(store: Map<string, unknown>) {
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    api: {
      storage: {
        local: {
          get: vi.fn(async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {})),
          set: vi.fn(async (payload: Record<string, unknown>) => {
            writes.push(payload);
            for (const [k, v] of Object.entries(payload)) store.set(k, v);
          }),
        },
      },
    },
  };
}

/** Build the four controls popup.ts looks up by id. */
function mountControls(doc: ReturnType<typeof stubFakeDom>["doc"]) {
  const make = (id: string, tag = "input") => {
    const el = doc.createElement(tag);
    el.id = id;
    doc.register(el);
    return el as FakeEl & { checked: boolean };
  };
  return {
    cleaned: make("mode-cleaned"),
    raw: make("mode-raw"),
    debug: make("debug-logs"),
    status: make("status-text", "p"),
  };
}

function fire(el: FakeEl, type: string): void {
  for (const fn of [...(el.listeners[type] ?? [])]) fn();
}

async function bootPopup(options: { store?: Map<string, unknown>; storageThrows?: boolean } = {}) {
  const { doc } = stubFakeDom();
  const controls = mountControls(doc);
  const store = options.store ?? new Map<string, unknown>();

  const fake = makeFakeBrowser(store);
  if (options.storageThrows) {
    fake.api.storage.local.get = vi.fn(async () => {
      throw new Error("storage disabled");
    });
    fake.api.storage.local.set = vi.fn(async () => {
      throw new Error("quota");
    });
  }

  vi.stubGlobal("browser", fake.api);
  // The popup runs at a chrome-extension:// URL, so no ?chdebug can apply.
  vi.stubGlobal("location", { href: "chrome-extension://abcdefghijklmnop/popup/popup.html" });

  vi.resetModules();
  await import("../popup/popup");

  const debug = await import("../content/debug");
  const read = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  await read();

  return { controls, store, writes: fake.writes, debug, settle: read };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("popup — export mode", () => {
  it("reflects the stored mode and its status text on open", async () => {
    const { controls } = await bootPopup({ store: new Map([[EXPORT_MODE_KEY, "raw"]]) });

    expect(controls.raw.checked).toBe(true);
    expect(controls.cleaned.checked).toBe(false);
    expect(controls.status.textContent).toBe("Format asli aktif");
  });

  it("defaults to the cleaned mode when nothing is stored", async () => {
    const { controls } = await bootPopup();

    expect(controls.cleaned.checked).toBe(true);
    expect(controls.status.textContent).toBe("Format dirapikan aktif");
  });

  it("persists a click instead of only repainting the radio", async () => {
    const { controls, store, writes, settle } = await bootPopup();

    controls.raw.checked = true;
    fire(controls.raw, "change");
    await settle();

    expect(store.get(EXPORT_MODE_KEY)).toBe("raw");
    expect(writes).toEqual([{ [EXPORT_MODE_KEY]: "raw" }]);
    expect(controls.status.textContent).toBe("Format asli aktif");
  });

  it("ignores the deselect half of a radio change", async () => {
    const { controls, writes, settle } = await bootPopup();

    // The browser clears `checked` on the losing radio before firing its
    // `change`; only the newly selected one may write.
    controls.cleaned.checked = false;
    fire(controls.cleaned, "change");
    await settle();

    expect(writes).toEqual([]);
  });
});

describe("popup — debug switch", () => {
  it("shows the stored switch state on open", async () => {
    const on = await bootPopup({ store: new Map([[DEBUG_KEY, true]]) });
    expect(on.controls.debug.checked).toBe(true);

    const off = await bootPopup({ store: new Map([[DEBUG_KEY, false]]) });
    expect(off.controls.debug.checked).toBe(false);
  });

  it("writes a boolean under the shared key and turns this context's logs on", async () => {
    const { controls, debug, writes, settle } = await bootPopup();
    expect(debug.isDebugEnabled()).toBe(false);

    controls.debug.checked = true;
    fire(controls.debug, "change");
    await settle();

    // A boolean, not the string form: that is what every reader normalizes.
    expect(writes).toEqual([{ [DEBUG_KEY]: true }]);
    expect(debug.isDebugEnabled()).toBe(true);
  });

  it("turns them back off when the switch is cleared", async () => {
    const { controls, debug, store, settle } = await bootPopup({ store: new Map([[DEBUG_KEY, true]]) });
    expect(debug.isDebugEnabled()).toBe(true);

    controls.debug.checked = false;
    fire(controls.debug, "change");
    await settle();

    expect(store.get(DEBUG_KEY)).toBe(false);
    expect(debug.isDebugEnabled()).toBe(false);
  });

  it("still opens when storage is unavailable", async () => {
    const { controls, debug, settle } = await bootPopup({ storageThrows: true });

    // Unreadable preference: the radios fall back to the default and the switch
    // to unchecked — the popup stays usable instead of ending up half-rendered,
    // and the failed read must not escape as an unhandled rejection either.
    expect(controls.cleaned.checked).toBe(true);
    expect(controls.debug.checked).toBe(false);
    expect(debug.isDebugEnabled()).toBe(false);

    // A failed write is contained the same way.
    controls.debug.checked = true;
    fire(controls.debug, "change");
    await expect(settle()).resolves.toBeUndefined();
  });
});
