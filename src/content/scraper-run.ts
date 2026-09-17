// Per-operation ownership: cancelling a run never revives it when another starts.
export interface ScrapeRun {
  id: number;
  signal: AbortSignal;
  isCurrent(): boolean;
  finish(): void;
}

export function createScrapeRuns() {
  let active: AbortController | null = null;
  return {
    isRunning: () => active !== null,
    cancel(): void {
      const previous = active;
      active = null;
      previous?.abort();
    },
    start(id: number): ScrapeRun | null {
      if (active) return null;
      const controller = new AbortController();
      active = controller;
      return {
        id,
        signal: controller.signal,
        isCurrent: () => active === controller && !controller.signal.aborted,
        finish: () => {
          if (active === controller) active = null;
        },
      };
    },
  };
}
