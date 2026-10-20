// ============================================================
// PREFERENCE-CONTROLS.UNIT.TEST.TS — the popup's one binder
// ============================================================
// The binder exists so a preference control cannot forget the
// defensive lookup, the normalizer or the write (ADR-0037). What is
// pinned here is the binder's OWN contract, because popup.ts's rows
// are already driven end to end by popup.unit.test.ts through the
// real markup ids.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubFakeDom, type FakeDoc } from "./__mocks__/fake-dom";
import type { ExtensionPreferences } from "../content/preferences";
import {
  bindPreferenceControls,
  paintPreferenceControls,
  type PreferenceControl,
} from "../popup/preference-controls";
import { DEFAULT_PREFERENCES } from "../content/preferences";

/** A typed write spy, so the binder's deps stay checkable in the cases below. */
const writeSpy = () =>
  vi.fn(async (patch: Partial<ExtensionPreferences>): Promise<void> => {
    void patch;
  });
const saySpy = () =>
  vi.fn((message: string): void => {
    void message;
  });

describe("the popup's preference-control binder", () => {
  let doc: FakeDoc;
  let write: ReturnType<typeof writeSpy>;
  let say: ReturnType<typeof saySpy>;

  /** Put one element in the fake document, the way popup.html declares it. */
  function control(
    id: string,
    over: Partial<PreferenceControl> = {},
  ): PreferenceControl {
    return {
      id,
      paint: () => {},
      patch: () => ({ enabled: true }),
      ...over,
    };
  }

  function mount(...ids: string[]): void {
    for (const id of ids) {
      const element = doc.createElement("input");
      element.id = id;
      doc.register(element);
    }
  }

  function fire(id: string, event = "change"): void {
    const element = doc.getElementById(id)!;
    for (const listener of [...(element.listeners[event] ?? [])]) listener();
  }

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };

  beforeEach(() => {
    doc = stubFakeDom().doc;
    write = writeSpy();
    say = saySpy();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("paints every control from one snapshot", () => {
    // One read feeds every control: a second read per control is how two
    // controls ended up showing values from two different snapshots.
    const painted: unknown[] = [];
    paintPreferenceControls(
      [
        control("a", { paint: (prefs) => painted.push(prefs.enabled) }),
        control("b", { paint: (prefs) => painted.push(prefs.exportFormat) }),
      ],
      DEFAULT_PREFERENCES,
    );

    expect(painted).toEqual([DEFAULT_PREFERENCES.enabled, DEFAULT_PREFERENCES.exportFormat]);
  });

  it("writes the patch a change produces", async () => {
    mount("a");
    bindPreferenceControls([control("a", { patch: () => ({ oneClickExport: true }) })], {
      write,
      say,
    });

    fire("a");
    await flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ oneClickExport: true });
  });

  it("stores nothing for the losing half of a radio pair", async () => {
    // The browser clears `checked` on the radio that loses the click, then
    // fires its own `change`; a row that answered it would flip the value back.
    mount("a");
    bindPreferenceControls([control("a", { patch: () => null })], { write, say });

    fire("a");
    await flush();

    expect(write).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  it("honours a control's own event", async () => {
    mount("a");
    // A prefix box persists while typing, so closing the popup without
    // blurring the field cannot lose it.
    bindPreferenceControls([control("a", { event: "input" })], { write, say });

    fire("a", "change");
    await flush();
    expect(write).not.toHaveBeenCalled();

    fire("a", "input");
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("binds the controls that exist and ignores one the markup lacks", async () => {
    // The popup degrades to whatever the document contains: a missing element
    // is a control that does nothing, never a popup that throws on open.
    mount("a");
    const missing = control("not-in-the-markup");

    expect(() =>
      bindPreferenceControls([missing, control("a")], { write, say }),
    ).not.toThrow();

    fire("a");
    await flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("rolls the control back and says why when a gate refuses", async () => {
    mount("a");
    const revert = vi.fn();
    bindPreferenceControls(
      [
        control("a", {
          beforeWrite: async () => false,
          revert,
          refused: () => "Izin ditolak.",
        }),
      ],
      { write, say },
    );

    fire("a");
    await flush();

    expect(write).not.toHaveBeenCalled();
    expect(revert).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith("Izin ditolak.");
  });

  it("stays silent on a refusal that has no line of its own", async () => {
    mount("a");
    bindPreferenceControls([control("a", { beforeWrite: async () => false })], { write, say });

    fire("a");
    await flush();

    expect(write).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });

  it("says the control's own line once the write landed", async () => {
    mount("a");
    bindPreferenceControls(
      [control("a", { status: (patch) => (patch.enabled ? "aktif" : "mati") })],
      { write, say },
    );

    fire("a");
    await flush();

    expect(say).toHaveBeenCalledWith("aktif");
    // The line comes after the write, not before it: a failure would otherwise
    // be announced as success.
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(say.mock.invocationCallOrder[0]);
  });

  it("carries the whole stored object for a grouped default", async () => {
    // The comparer's controls are ONE stored value, so every member writes all
    // of it rather than the field it happens to touch.
    mount("a", "b");
    const defaults: ExtensionPreferences["comparerDefaults"] = {
      tolerance: 5,
      dailyDates: "1",
      statusFilter: [],
    };
    const row = (id: string): PreferenceControl =>
      control(id, { patch: () => ({ comparerDefaults: defaults }) });

    bindPreferenceControls([row("a"), row("b")], { write, say });

    fire("b");
    await flush();

    expect(write).toHaveBeenCalledWith({ comparerDefaults: defaults });
  });
});
