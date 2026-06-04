import { vi } from "vitest";

export class MockXHR {
  status = 200;
  responseText = "";
  timeout = 0;
  readyState = 4;

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onreadystatechange: (() => void) | null = null;

  open = vi.fn();
  send = vi.fn();
  setRequestHeader = vi.fn();

  // URL and body captured by open/send for assertions
  _openedUrl = "";
  _openedAsync = true;
  _sentBody: Document | XMLHttpRequestBodyInit | null = null;

  // Simulate response triggers
  _triggerLoad(responseText?: string, status?: number): void {
    if (responseText !== undefined) this.responseText = responseText;
    if (status !== undefined) this.status = status;
    this.onload?.();
  }

  _triggerError(): void {
    this.onerror?.();
  }

  _triggerTimeout(): void {
    this.ontimeout?.();
  }
}

/**
 * Stub global XMLHttpRequest with MockXHR.
 * Returns the instances array so tests can inspect them.
 */
export function stubXHR(): { instances: MockXHR[] } {
  const instances: MockXHR[] = [];

  class XHRStub extends MockXHR {
    constructor() {
      super();
      instances.push(this);
    }
  }

  vi.stubGlobal("XMLHttpRequest", XHRStub);
  return { instances };
}
