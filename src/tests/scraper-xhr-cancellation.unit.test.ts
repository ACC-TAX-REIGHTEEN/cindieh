import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeXhrRequest,
  xhrRequest,
  xhrRequestByInvoice,
  xhrDownloadWithholdingPdf,
  xhrDownloadEfakturPdf,
} from "../content/scraper-xhr";
import type { CapturedRequest } from "../content/scraper-types";
import { MockXHR } from "./__mocks__/xhr-mock";

const captured: CapturedRequest = {
  url: "https://example.com/GetMyWithholdingSlip",
  headers: {},
  body: null,
  rawBody: "{}",
  response: null,
  initialData: [],
  initialFirst: 0,
  source: "OUTPUT_TAX",
};
const response = JSON.stringify({
  IsSuccessful: true,
  Content: "A".repeat(200),
  Payload: { Data: [] },
});

class AbortableXHR extends MockXHR {
  __isCindiehBulk?: boolean;
  onabort: (() => void) | null = null;
  abort = vi.fn(() => this.onabort?.());
}

const requests: Array<[string, (signal?: AbortSignal) => Promise<unknown>]> = [
  ["makeXhrRequest", (signal) => makeXhrRequest(captured, {}, 30000, signal)],
  ["xhrRequest", (signal) => xhrRequest(captured, 0, 500, 30000, signal)],
  ["xhrRequestByInvoice", (signal) => xhrRequestByInvoice(captured, "INV-1", 30000, signal)],
  ["xhrDownloadWithholdingPdf", (signal) => xhrDownloadWithholdingPdf(captured, {}, 30000, signal)],
  ["xhrDownloadEfakturPdf", (signal) => xhrDownloadEfakturPdf(captured, {}, "OUTPUT_TAX", 30000, signal)],
];

describe.each(requests)("%s cancellation", (_name, request) => {
  let instances: AbortableXHR[];
  beforeEach(() => {
    instances = [];
    vi.stubGlobal("XMLHttpRequest", class extends AbortableXHR {
      constructor() {
        super();
        instances.push(this);
      }
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects pre-aborted signals without creating or sending an XHR", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(request(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(instances).toHaveLength(0);
  });

  it("aborts a live XHR once, preserves the bulk flag, and removes its listener", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const promise = request(controller.signal);
    const xhr = instances[0];
    expect(xhr.send).toHaveBeenCalledOnce();
    expect(xhr.__isCindiehBulk).toBe(true);
    controller.abort();
    xhr._triggerLoad(response);
    xhr._triggerError();
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(xhr.abort).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0][1]);
  });

  it.each(["load", "parse", "http", "error", "timeout", "abort"] as const)(
    "removes the listener on %s settlement and ignores later cancellation",
    async (event) => {
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, "addEventListener");
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const promise = request(controller.signal);
      const xhr = instances[0];
      if (event === "load") xhr._triggerLoad(response);
      if (event === "parse") xhr._triggerLoad("invalid-json");
      if (event === "http") xhr._triggerLoad("{}", 500);
      if (event === "error") xhr._triggerError();
      if (event === "timeout") xhr._triggerTimeout();
      if (event === "abort") xhr.onabort?.();
      if (event === "load") await expect(promise).resolves.toBeDefined();
      else await expect(promise).rejects.toThrow();
      expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0][1]);
      controller.abort();
      expect(xhr.abort).not.toHaveBeenCalled();
    },
  );

  it("removes the listener when send throws synchronously", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.stubGlobal("XMLHttpRequest", class extends AbortableXHR {
      send = vi.fn(() => { throw new Error("send failed"); });
    });
    await expect(request(controller.signal)).rejects.toThrow("send failed");
    expect(remove).toHaveBeenCalledOnce();
  });
});
