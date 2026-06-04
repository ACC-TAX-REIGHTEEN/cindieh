/**
 * Pure function: validates a postMessage event should be processed.
 * Exported for testing.
 */
export function shouldProcessPageMessage(event: {
  source: unknown;
  origin: string;
  data: unknown;
}): boolean {
  return (
    event.source === window &&
    event.origin === window.location.origin &&
    !!event.data &&
    (event.data as Record<string, unknown>).direction === "FROM_PAGE"
  );
}
