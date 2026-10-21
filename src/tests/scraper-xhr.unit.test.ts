import { describe, it, expect, beforeEach } from "vitest";
import { makeXhrRequest, xhrRequest, xhrRequestByInvoice , readGridTotal } from "../content/scraper-xhr";
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

// The portal row count is the only way to tell a short page that ENDS the
// data from a short page the server produced by capping its page size. These
// pin how the count is read, including every way it can be absent.
describe("readGridTotal", () => {
  it("reads the count from the inner Payload", () => {
    expect(readGridTotal({ Payload: { Data: [], Total: 1234 } })).toBe(1234);
    expect(readGridTotal({ Payload: { Data: [], TotalRecords: 7 } })).toBe(7);
    expect(readGridTotal({ Payload: { Data: [], TotalCount: 8 } })).toBe(8);
    expect(readGridTotal({ Payload: { Data: [], Count: 9 } })).toBe(9);
  });

  it("falls back to a count on the envelope", () => {
    expect(readGridTotal({ Total: 42, Payload: { Data: [] } })).toBe(42);
  });

  it("prefers the inner payload over the envelope", () => {
    expect(readGridTotal({ Total: 42, Payload: { Data: [], Total: 7 } })).toBe(7);
  });

  it("returns null when no count is present, so callers read it as unknown", () => {
    expect(readGridTotal({ Payload: { Data: [] } })).toBeNull();
    expect(readGridTotal({})).toBeNull();
  });

  // Measured against the live portal on 2026-10-06:
  // /einvoiceportal/api/outputinvoice/list answered Rows=10 with
  // TotalRecords 11, Rows=100 with 101 ... Rows=5000 with 5001. The number
  // tracked the page size, never the grid.
  describe("a count that merely echoes the page size", () => {
    it.each([
      [10, 11],
      [100, 101],
      [500, 501],
      [1000, 1001],
      [2000, 2001],
      [5000, 5001],
    ])("rejects TotalRecords %i reported against Rows %i", (rows, reported) => {
      expect(readGridTotal({ Payload: { Data: [], TotalRecords: reported } }, rows)).toBeNull();
    });

    // Measured against PPN Masukan on 2026-10-21: a page that came back SHORT
    // was answered with the request itself — Rows=500 with 235 rows answered
    // 500. Read as a total, that says the grid holds exactly what we asked for,
    // so every month shorter than the page size would be reported as truncated
    // and a finished year would be called "mungkin belum lengkap".
    it.each([
      [500, 500],
      [1000, 1000],
      [2000, 2000],
      [5000, 5000],
    ])("rejects the page size echoed back as TotalRecords %i against Rows %i", (rows, reported) => {
      expect(readGridTotal({ Payload: { Data: [], TotalRecords: reported } }, rows)).toBeNull();
    });

    it("still believes a count that is not the echo", () => {
      // The real grid holds at least 5000 rows, so anything else is a count.
      expect(readGridTotal({ Payload: { Data: [], TotalRecords: 8421 } }, 500)).toBe(8421);
      expect(readGridTotal({ Payload: { Data: [], TotalRecords: 400 } }, 500)).toBe(400);
    });

    it("falls through to another field rather than stopping at the echo", () => {
      expect(
        readGridTotal({ Payload: { Data: [], Total: 501, TotalRecords: 501 } }, 500),
      ).toBeNull();
      expect(
        readGridTotal({ Payload: { Data: [], Count: 9000, TotalRecords: 501 } }, 500),
      ).toBe(9000);
    });

    it("trusts the echo when the caller cannot say what it asked for", () => {
      expect(readGridTotal({ Payload: { Data: [], TotalRecords: 501 } })).toBe(501);
    });

    it("does not touch a total from an endpoint that reports it honestly", () => {
      expect(readGridTotal({ Payload: { Data: [], TotalRecords: 501 } }, 100)).toBe(501);
    });
    expect(readGridTotal(null)).toBeNull();
    expect(readGridTotal("nonsense")).toBeNull();
  });

  it("rejects a count that is not a usable number", () => {
    // A negative or NaN count would make every run look truncated.
    expect(readGridTotal({ Payload: { Data: [], Total: -1 } })).toBeNull();
    expect(readGridTotal({ Payload: { Data: [], Total: NaN } })).toBeNull();
    expect(readGridTotal({ Payload: { Data: [], Total: "1200" } })).toBeNull();
  });

  it("accepts a genuine zero, which is a real answer", () => {
    expect(readGridTotal({ Payload: { Data: [], Total: 0 } })).toBe(0);
  });
});

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

  // The live endpoint's own behaviour, measured 2026-10-06: every page size
  // came back with Payload.TotalRecords = Rows + 1. Taken as a count, a
  // complete 500-row export would read as "500 of 501" and the panel would
  // call it truncated. This is the path that produced that number.
  describe("a page the portal padded its own count onto", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ RecordId: i }));

    it("hands back no total, so a complete export is not called short", async () => {
      const promise = xhrRequest(makeCaptured(), 0, 500, 30000);
      instances[0]._triggerLoad(
        JSON.stringify({ Payload: { Data: rows(500), TotalRecords: 501 } }),
      );

      const page = await promise;

      expect(page.rows).toHaveLength(500);
      expect(page.total).toBeNull();
    });

    it("still reports a count that is not the echo", async () => {
      const promise = xhrRequest(makeCaptured(), 0, 500, 30000);
      instances[0]._triggerLoad(
        JSON.stringify({ Payload: { Data: rows(500), TotalRecords: 8421 } }),
      );

      expect((await promise).total).toBe(8421);
    });

    it("leaves the untruncated run to the short page, which is what ends it", async () => {
      // Rows=500 asked, 1 row back: the page is short, so the loop stops on
      // its own. The count never had to be the thing that noticed.
      const promise = xhrRequest(makeCaptured(), 0, 500, 30000);
      instances[0]._triggerLoad(
        JSON.stringify({ Payload: { Data: rows(1), TotalRecords: 501 } }),
      );

      const page = await promise;
      expect(page.rows.length).toBeLessThan(500);
      expect(page.total).toBeNull();
    });
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

  it("falls back to the Filters key when rawBody is not valid JSON", async () => {
    const captured = makeCaptured({ rawBody: "not-json{{{" });
    const promise = xhrRequestByInvoice(captured, "INV-789", 30000);

    instances[0]._triggerLoad(JSON.stringify({ Payload: { Data: [] } }));
    await promise;

    const sentBody = JSON.parse(instances[0].send.mock.calls[0][0] as string);
    expect(sentBody.Filters).toHaveLength(1);
    expect(sentBody.Filters[0]).toMatchObject({
      PropertyName: "TaxInvoiceNumber",
      Value: "INV-789",
      MatchMode: "equals",
    });
  });
});
