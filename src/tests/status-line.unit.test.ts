// Unit tests for status-line.ts — the panel tabs' one status field.
//
// The module exists so the promise, a summary, an error and the retirement
// notice cannot be written by four paths per tab. What has to hold: the kind
// decides the class (no caller picks one), the line looks its element up on
// every call (the panel is re-injected), and `replace` fires only while the
// line still shows the kind the tab last set — which is what keeps a summary a
// retirement landing afterwards must not overwrite (ADR-0026, ADR-0029).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubFakeDom, type FakeDoc, type FakeEl } from "./__mocks__/fake-dom";
import { createStatusLine } from "../content/status-line";

const ID = "ch-test-status";

let doc: FakeDoc;

function mountStatus(text = ""): FakeEl {
  const el = doc.createElement("div");
  el.id = ID;
  el.className = "ch-comparer-status";
  el.textContent = text;
  doc.body.appendChild(el);
  return el;
}

function statusEl(): FakeEl {
  return doc.getElementById(ID)!;
}

beforeEach(() => {
  ({ doc } = stubFakeDom());
});

afterEach(() => {
  doc.body.children.length = 0;
});

describe("status-line — set", () => {
  it("paints the text and the class its kind means", () => {
    mountStatus();
    const line = createStatusLine(ID);

    line.set("waiting", "Mohon tunggu...");

    expect(statusEl().textContent).toBe("Mohon tunggu...");
    expect(statusEl().className).toBe("ch-comparer-status ch-comparer-status-info");
    expect(line.kind()).toBe("waiting");
  });

  it("paints an error in the error weight, so no caller has to know the class", () => {
    mountStatus();
    const line = createStatusLine(ID);

    line.set("error", "Perbandingan tidak bisa dijalankan.");

    expect(statusEl().className).toBe("ch-comparer-status ch-comparer-status-error");
    expect(line.kind()).toBe("error");
  });

  it("paints the retirement notice quietly, so the badge stays the primary account", () => {
    mountStatus();
    const line = createStatusLine(ID);

    line.set("notice", "Permintaan dibatalkan.");

    expect(statusEl().className).toBe("ch-comparer-status");
    expect(line.kind()).toBe("notice");
  });

  it("reports that nothing was written when the element is not on the page", () => {
    const line = createStatusLine(ID);

    expect(line.set("waiting", "Mohon tunggu...")).toBe(false);
    // Nothing was shown, so nothing may claim to be pending either.
    expect(line.kind()).toBeNull();
  });
});

describe("status-line — replace", () => {
  it("replaces the promise it made, and nothing else", () => {
    mountStatus();
    const line = createStatusLine(ID);
    line.set("waiting", "Mohon tunggu...");

    expect(line.replace("waiting", { kind: "notice", text: "Dibatalkan." })).toBe(true);

    expect(statusEl().textContent).toBe("Dibatalkan.");
    expect(statusEl().className).toBe("ch-comparer-status");
    expect(line.kind()).toBe("notice");
  });

  it("leaves a summary alone when a retirement lands afterwards", () => {
    // The summary is the tab's own output; a stop arriving later must not wipe
    // findings the user is reading.
    mountStatus();
    const line = createStatusLine(ID);
    line.set("summary", "5 faktur diperiksa.");

    expect(line.replace("waiting", { kind: "notice", text: "Dibatalkan." })).toBe(false);

    expect(statusEl().textContent).toBe("5 faktur diperiksa.");
    expect(statusEl().className).toBe("ch-comparer-status ch-comparer-status-info");
  });

  it("leaves an error alone, and a cleared line alone", () => {
    mountStatus();
    const line = createStatusLine(ID);

    line.set("error", "Gagal membuat berkas Excel.");
    expect(line.replace("waiting", { kind: "notice", text: "Dibatalkan." })).toBe(false);
    expect(statusEl().textContent).toBe("Gagal membuat berkas Excel.");

    line.clear();
    expect(line.replace("waiting", { kind: "notice", text: "Dibatalkan." })).toBe(false);
    expect(statusEl().textContent).toBe("");
  });

  it("consumes the promise even when the panel is already gone", () => {
    // Teardown between the promise and the retirement: nothing to paint, and the
    // line must not keep saying "waiting" for an element that appears later.
    mountStatus();
    const line = createStatusLine(ID);
    line.set("waiting", "Mohon tunggu...");
    statusEl().remove();

    expect(line.replace("waiting", { kind: "notice", text: "Dibatalkan." })).toBe(false);
    expect(line.kind()).toBeNull();
  });

  it("does not fire twice: one retirement consumes the promise", () => {
    // Two retirements announcing the same kind must not paint the reason over
    // something the user has since seen — the first one already replaced it.
    mountStatus();
    const line = createStatusLine(ID);
    line.set("waiting", "Mohon tunggu...");

    expect(line.replace("waiting", { kind: "notice", text: "Dibatalkan." })).toBe(true);
    expect(line.replace("waiting", { kind: "notice", text: "Dibatalkan." })).toBe(false);
  });
});

describe("status-line — clear and the live element", () => {
  it("empties the line, drops the tint and forgets the kind", () => {
    mountStatus();
    const line = createStatusLine(ID);
    line.set("summary", "5 faktur diperiksa.");

    line.clear();

    expect(statusEl().textContent).toBe("");
    expect(statusEl().className).toBe("ch-comparer-status");
    expect(line.kind()).toBeNull();
  });

  it("writes to whatever element currently carries the id", () => {
    // Angular re-renders the panel header; the captured node would go on being
    // painted after the live one replaced it.
    const first = mountStatus();
    const line = createStatusLine(ID);
    line.set("waiting", "Mohon tunggu...");

    first.remove();
    mountStatus();

    expect(line.set("summary", "5 faktur diperiksa.")).toBe(true);
    expect(statusEl()).not.toBe(first);
    expect(statusEl().textContent).toBe("5 faktur diperiksa.");
  });

  it("forgets its kind when cleared after the element is already gone", () => {
    // The panel was torn down between the promise and the retirement: there is
    // nothing left to paint, but the line must not keep claiming to be waiting,
    // or a later retirement would write into whatever element appears next.
    mountStatus();
    const line = createStatusLine(ID);
    line.set("waiting", "Mohon tunggu...");
    statusEl().remove();

    line.clear();

    expect(line.kind()).toBeNull();
    expect(line.replace("waiting", { kind: "notice", text: "Dibatalkan." })).toBe(false);
  });
});
