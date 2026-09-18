// Unit tests for scraper-fetch.ts — the fetch interceptor for native PDF
// downloads. Extracted from the scraper.ts IIFE precisely so these cases can
// run without a browser.
//
// The load-bearing contract under test: the request is issued exactly
// ONCE. The previous inline version replayed the request from its catch block,
// so a response that failed to parse hit the download endpoint twice and let an
// un-sabotaged second response reach the portal.
import { describe, it, expect, vi } from "vitest";
import {
  DOWNLOAD_ENDPOINT,
  createFetchDownloadInterceptor,
  isBulkFetchRequest,
} from "../content/scraper-fetch";

const DOWNLOAD_URL = `https://coretaxdjp.pajak.go.id/api/${DOWNLOAD_ENDPOINT}`;
const LIST_URL = "https://coretaxdjp.pajak.go.id/api/GetMyWithholdingSlip";
const PDF_BASE64 = "B".repeat(150);
const DUMMY = JSON.stringify({ IsSuccessful: false, Content: "" });

/**
 * Session stub: beginProcessing / handleNativeResponse / clearProcessing.
 * The response handler records what it was handed, so tests can assert the
 * request body the session resolves invoice rows from.
 */
function makeSession(intercepted: boolean) {
  const seen: Array<{ response: unknown; requestBody: string }> = [];
  return {
    seen,
    beginProcessing: vi.fn(),
    handleNativeResponse: vi.fn((response: unknown, requestBody: string) => {
      seen.push({ response, requestBody });
      return { intercepted };
    }),
    clearProcessing: vi.fn(),
  };
}

/** Original-fetch stub. Throws when given an Error, otherwise returns it. */
function makeOriginalFetch(result: Response | Error) {
  return vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
}

function makeInterceptor(
  originalFetch: ReturnType<typeof makeOriginalFetch>,
  session: ReturnType<typeof makeSession>,
): typeof fetch {
  return createFetchDownloadInterceptor({
    originalFetch: originalFetch as unknown as typeof fetch,
    session,
    buildDummyResponse: () => DUMMY,
  });
}

describe("createFetchDownloadInterceptor", () => {
  it("issues the request exactly ONCE when the response cannot be parsed, never replaying it", async () => {
    const originalFetch = makeOriginalFetch(new Response("not-json", { status: 200 }));
    const session = makeSession(false);
    const interceptedFetch = makeInterceptor(originalFetch, session);

    const resp = await interceptedFetch(DOWNLOAD_URL, { body: "{}" } as RequestInit);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    // The real response is handed back untouched — not re-fetched, not faked.
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("not-json");
    expect(session.handleNativeResponse).not.toHaveBeenCalled();
    expect(session.clearProcessing).toHaveBeenCalledTimes(1);
  });

  it("hands the real response back when parsing fails inside the response body read", async () => {
    // Empty body: JSON.parse of "" throws, same path as invalid JSON.
    const originalFetch = makeOriginalFetch(new Response("", { status: 200 }));
    const session = makeSession(false);
    const interceptedFetch = makeInterceptor(originalFetch, session);

    const resp = await interceptedFetch(DOWNLOAD_URL);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(resp.status).toBe(200);
    expect(session.handleNativeResponse).not.toHaveBeenCalled();
  });

  it("returns the failure dummy and emits once when the PDF is intercepted", async () => {
    const originalFetch = makeOriginalFetch(
      new Response(JSON.stringify({ IsSuccessful: true, Content: PDF_BASE64 }), { status: 200 }),
    );
    const session = makeSession(true);
    const interceptedFetch = makeInterceptor(originalFetch, session);
    const body = JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" });

    const resp = await interceptedFetch(DOWNLOAD_URL, { body } as RequestInit);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(session.beginProcessing).toHaveBeenCalledTimes(1);
    expect(session.handleNativeResponse).toHaveBeenCalledTimes(1);
    expect(session.seen[0].requestBody).toBe(body);

    expect(resp.headers.get("Content-Type")).toBe("application/json");
    const payload = JSON.parse(await resp.text()) as { IsSuccessful: boolean; Content: string };
    expect(payload.IsSuccessful).toBe(false);
    expect(payload.Content).toBe("");
  });

  it("passes the real response through when no PDF payload is found", async () => {
    const real = JSON.stringify({ IsSuccessful: false, Message: "Error" });
    const originalFetch = makeOriginalFetch(new Response(real, { status: 200 }));
    const session = makeSession(false);
    const interceptedFetch = makeInterceptor(originalFetch, session);

    const resp = await interceptedFetch(DOWNLOAD_URL, { body: "{}" } as RequestInit);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(session.handleNativeResponse).toHaveBeenCalledTimes(1);
    expect(await resp.text()).toBe(real); // the portal's own response, not a dummy
  });

  it("reads the request body from a Request object for row resolution", async () => {
    const originalFetch = makeOriginalFetch(
      new Response(JSON.stringify({ Content: PDF_BASE64 }), { status: 200 }),
    );
    const session = makeSession(true);
    const interceptedFetch = makeInterceptor(originalFetch, session);
    const body = JSON.stringify({ TaxInvoiceNumber: "010.000-26.00000001" });

    await interceptedFetch(
      new Request(DOWNLOAD_URL, { method: "POST", body }),
    );

    expect(session.seen[0].requestBody).toBe(body);
  });

  it("rethrows a failed request without replaying it or handling a response", async () => {
    const originalFetch = makeOriginalFetch(new Error("network down"));
    const session = makeSession(true);
    const interceptedFetch = makeInterceptor(originalFetch, session);

    await expect(interceptedFetch(DOWNLOAD_URL)).rejects.toThrow("network down");

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(session.handleNativeResponse).not.toHaveBeenCalled();
    expect(session.clearProcessing).toHaveBeenCalledTimes(1);
  });

  it("never touches unrelated endpoints", async () => {
    const originalFetch = makeOriginalFetch(new Response("{}", { status: 200 }));
    const session = makeSession(true);
    const interceptedFetch = makeInterceptor(originalFetch, session);

    await interceptedFetch(LIST_URL, { body: "{}" } as RequestInit);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(session.beginProcessing).not.toHaveBeenCalled();
    expect(session.handleNativeResponse).not.toHaveBeenCalled();
  });

  it("skips extension-owned bulk downloads flagged on RequestInit", async () => {
    const originalFetch = makeOriginalFetch(
      new Response(JSON.stringify({ Content: PDF_BASE64 }), { status: 200 }),
    );
    const session = makeSession(true);
    const interceptedFetch = makeInterceptor(originalFetch, session);

    await interceptedFetch(DOWNLOAD_URL, { __isCindiehBulk: true } as RequestInit);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(session.beginProcessing).not.toHaveBeenCalled();
    expect(session.handleNativeResponse).not.toHaveBeenCalled();
  });

  it("skips extension-owned bulk downloads flagged on the Request object", async () => {
    const originalFetch = makeOriginalFetch(new Response("{}", { status: 200 }));
    const session = makeSession(true);
    const interceptedFetch = makeInterceptor(originalFetch, session);
    const req = new Request(DOWNLOAD_URL, { method: "POST", body: "{}" });
    (req as Request & { __isCindiehBulk?: boolean }).__isCindiehBulk = true;

    await interceptedFetch(req);

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(session.beginProcessing).not.toHaveBeenCalled();
  });
});

describe("isBulkFetchRequest", () => {
  it("detects the flag on RequestInit", () => {
    expect(isBulkFetchRequest("https://x/y", { __isCindiehBulk: true })).toBe(true);
  });

  it("detects the flag on a Request object", () => {
    expect(isBulkFetchRequest({ url: "https://x/y", __isCindiehBulk: true })).toBe(true);
  });

  it("is false without the flag", () => {
    expect(isBulkFetchRequest("https://x/y", { method: "POST" })).toBe(false);
    expect(isBulkFetchRequest({ url: "https://x/y" })).toBe(false);
    expect(isBulkFetchRequest()).toBe(false);
  });
});
