/**
 * Pure function: validates a postMessage event should be processed.
 * Exported for testing.
 *
 * @param event    - The MessageEvent-like object to validate.
 * @param expectedToken - When provided, event.data.token must match.
 * @param selfWindow    - The reference window to compare event.source against.
 *                        Defaults to `window` (the global). Pass a stub in tests.
 */
export function shouldProcessPageMessage(
  event: {
    source: unknown;
    origin: string;
    data: unknown;
  },
  expectedToken?: string,
  selfWindow: { location: { origin: string } } = window,
): boolean {
  const data = event.data as Record<string, unknown> | undefined;
  return (
    event.source === selfWindow &&
    event.origin === selfWindow.location.origin &&
    !!data &&
    data.direction === "FROM_PAGE" &&
    // When a token is provided, the message must carry the matching token.
    (expectedToken === undefined || data.token === expectedToken)
  );
}
