/**
 * Pure function: validates a postMessage event should be processed.
 * Exported for testing.
 */
export function shouldProcessPageMessage(event: {
  source: unknown;
  origin: string;
  data: unknown;
}, expectedToken?: string): boolean {
  const data = event.data as Record<string, unknown> | undefined;
  return (
    event.source === window &&
    event.origin === window.location.origin &&
    !!data &&
    data.direction === "FROM_PAGE" &&
    // When a token is provided, the message must carry the matching token.
    (expectedToken === undefined || data.token === expectedToken)
  );
}
