import { describe, it, expect } from "vitest";
import { createScrapeRuns } from "../content/scraper-run";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("scraper navigation lifecycle", () => {
  it("aborts navigation's old request and ignores its results and cleanup after a replacement starts", async () => {
    const runs = createScrapeRuns();
    const oldRequest = deferred();
    const oldRun = runs.start(1)!;
    const delivered: number[] = [];
    const oldWork = oldRequest.promise.then(() => {
      if (oldRun.isCurrent()) delivered.push(1);
      oldRun.finish();
    });

    runs.cancel(); // RESET_SCRAPER on SPA navigation
    const newRun = runs.start(3)!;
    expect(oldRun.signal.aborted).toBe(true);
    expect(oldRun.isCurrent()).toBe(false);
    oldRequest.resolve();
    await oldWork;

    expect(delivered).toEqual([]);
    expect(newRun.isCurrent()).toBe(true);
    expect(runs.isRunning()).toBe(true);
    expect(runs.start(4)).toBeNull();
    newRun.finish();
    expect(runs.isRunning()).toBe(false);
  });

  it("allows a fresh run immediately after Stop without reviving the cancelled run", () => {
    const runs = createScrapeRuns();
    const old = runs.start(1)!;
    runs.cancel();
    const next = runs.start(3)!;
    expect(old.signal.aborted).toBe(true);
    expect(next.signal.aborted).toBe(false);
    old.finish();
    expect(next.isCurrent()).toBe(true);
    next.finish();
    expect(next.isCurrent()).toBe(false);
  });
});
