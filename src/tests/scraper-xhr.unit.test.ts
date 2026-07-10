import { describe, it, expect, beforeEach } from "vitest";
import { makeXhrRequest, xhrRequest, xhrRequestByInvoice } from "../content/scraper-xhr";
import { MockXHR, stubXHR } from "./__mocks__/xhr-mock";
import type { CapturedRequest } from "../content/scraper-types";

function makeCaptured(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    url: "https://coretaxdjp.pajak.go.id/api/list",
    headers: { "Content-Type": "application/json", Authorization: "Bearer token123" },
    body: null,
    rawBody: JSON.stringify({ First: 0, Rows: 500, Filters: [] }),
    response: null,
    initialData: [],
    initialFirst: 0,
    source: "OUTPUT_TAX",
    ...overrides,
  };
}

describe("makeXhrRequest", () => {
  let instances: MockXHR[];

  beforeEach(() => {
    const result = stubXHR();
    instances = result.instances;
  });

  it("resolves with Payload.Data on successful response", async () => {
    const captured = makeCaptured();
    const promise = makeXhrRequest(captured, { First: 0, Rows: 500 }, 30000);

    instances[0]._triggerLoad(JSON.stringify({ Payload: { Data: [{ id: 1 }, { id: 2 }] } }));

    const result = await promise;
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("resolves with empty array when Payload.Data is missing", async () => {
    const captured = makeCaptured();
    const promise = makeXhrRequest(captured, { First: 0, Rows: 500 }, 30000);

    instances[0]._triggerLoad(JSON.stringify({ Payload: {} }));

    const result = await promise;
    expect(result).toEqual([]);
  });

  it("rejects with Parse error when response is invalid JSON", async () => {
    const captured = makeCaptured();
    const promise = makeXhrRequest(captured, { First: 0, Rows: 500 }, 30000);

    instances[0]._triggerLoad("not-json{{{", 200);

    await expect(promise).rejects.toThrow("Parse error");
  });

  it("rejects with HTTP error on non-2xx status", async () => {
    const captured = makeCaptured();
    const promise = makeXhrRequest(captured, { First: 0, Rows: 500 }, 30000);

    instances[0]._triggerLoad("{}", 404);

    await expect(promise).rejects.toThrow("HTTP 404");
  });

  it("rejects with Network error on xhr.onerror", async () => {
    const captured = makeCaptured();
    const promise = makeXhrRequest(captured, { First: 0, Rows: 500 }, 30000);

    instances[0]._triggerError();

    await expect(promise).rejects.toThrow("Network error");
  });

  it("rejects with Timeout error on xhr.ontimeout", async () => {
    const captured = makeCaptured();
    const promise = makeXhrRequest(captured, { First: 0, Rows: 500 }, 30000);

    instances[0]._triggerTimeout();

    await expect(promise).rejects.toThrow("Timeout");
  });

  it("sets correct headers from captured request", async () => {
    const captured = makeCaptured();
    const promise = makeXhrRequest(captured, { First: 0, Rows: 500 }, 30000);

    instances[0]._triggerLoad(JSON.stringify({ Payload: { Data: [] } }));
    await promise;

    expect(instances[0].setRequestHeader).toHaveBeenCalledWith("Content-Type", "application/json");
    expect(instances[0].setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer token123");
  });

  it("merges body overrides into the raw body", async () => {
    const captured = makeCaptured({ rawBody: JSON.stringify({ First: 0, Rows: 100 }) });
    const promise = makeXhrRequest(captured, { First: 200, Rows: 500 }, 30000);

    instances[0]._triggerLoad(JSON.stringify({ Payload: { Data: [] } }));
    await promise;

    const sentBody = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(sentBody.First).toBe(200);
    expect(sentBody.Rows).toBe(500);
  });

  it("sets xhr.timeout to the provided timeout value", async () => {
    const captured = makeCaptured();
    const promise = makeXhrRequest(captured, {}, 15000);

    instances[0]._triggerLoad(JSON.stringify({ Payload: { Data: [] } }));
    await promise;

    expect(instances[0].timeout).toBe(15000);
  });
});

describe("xhrRequest", () => {
  let instances: MockXHR[];

  beforeEach(() => {
    const result = stubXHR();
    instances = result.instances;
  });

  it("delegates to makeXhrRequest with First and Rows", async () => {
    const captured = makeCaptured({ rawBody: JSON.stringify({ Filters: [] }) });
    const promise = xhrRequest(captured, 500, 1000, 30000);

    instances[0]._triggerLoad(JSON.stringify({ Payload: { Data: [{ id: 1 }] } }));
    await promise;

    const sentBody = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(sentBody.First).toBe(500);
    expect(sentBody.Rows).toBe(1000);
  });
});

describe("xhrRequestByInvoice", () => {
  let instances: MockXHR[];

  beforeEach(() => {
    const result = stubXHR();
    instances = result.instances;
  });

  it("delegates to makeXhrRequest with invoice filter injected", async () => {
    const captured = makeCaptured({ rawBody: JSON.stringify({ Filters: [] }) });
    const promise = xhrRequestByInvoice(captured, "INV-123", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Payload: { Data: [] } }));
    await promise;

    const sentBody = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(sentBody.First).toBe(0);
    expect(sentBody.Rows).toBe(10);
    expect(sentBody.Filters).toHaveLength(1);
    expect(sentBody.Filters[0]).toMatchObject({
      PropertyName: "TaxInvoiceNumber",
      Value: "INV-123",
      MatchMode: "equals",
    });
  });

  it("uses lowercase 'filters' key when Filters is not present in raw body", async () => {
    const captured = makeCaptured({ rawBody: JSON.stringify({ filters: [] }) });
    const promise = xhrRequestByInvoice(captured, "INV-456", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Payload: { Data: [] } }));
    await promise;

    const sentBody = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(sentBody.filters).toHaveLength(1);
    expect(sentBody.filters[0].Value).toBe("INV-456");
  });
});
