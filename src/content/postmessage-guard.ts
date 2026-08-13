/**
 * Cross-world message seam: guard + dispatcher.
 * Pure (window injected for tests) so the security boundary is testable.
 *
 * The guard validates that a postMessage event is safe to process:
 * source must be self, origin must match, direction must match the world,
 * and (when a token is expected) the token must match.
 *
 * The dispatcher runs the guard once and fans out by message `type` to a
 * per-world handler table — the single place new message types register.
 */

export type MessageDirection = "FROM_PAGE" | "FROM_CONTENT";

export type MessageHandler = (msg: Record<string, unknown>) => void;

export interface MessageEventLike {
  source: unknown;
  origin: string;
  data: unknown;
}

/**
 * Validate a postMessage event should be processed.
 *
 * @param event        - The MessageEvent-like object to validate.
 * @param expectedToken - When provided, event.data.token must match.
 * @param selfWindow    - The reference window to compare event.source against.
 *                        Defaults to `window` (the global). Pass a stub in tests.
 * @param direction     - The message direction this world accepts.
 */
export function shouldProcessPageMessage(
  event: MessageEventLike,
  expectedToken?: string,
  selfWindow: { location: { origin: string } } = window,
  direction: MessageDirection = "FROM_PAGE",
): boolean {
  const data = event.data as Record<string, unknown> | undefined;
  return (
    event.source === selfWindow &&
    event.origin === selfWindow.location.origin &&
    !!data &&
    data.direction === direction &&
    // When a token is provided, the message must carry the matching token.
    (expectedToken === undefined || data.token === expectedToken)
  );
}

export interface MessageDispatcherOptions {
  /** The message direction this world accepts. */
  direction: MessageDirection;
  /** The bridge token every message must carry (string or getter function). */
  token: string | (() => string);
  /** Handler table keyed by message `type`. */
  handlers: Record<string, MessageHandler>;
  /** Reference window for origin/source checks. Defaults to `window`. */
  selfWindow?: { location: { origin: string } };
}

export interface MessageDispatcher {
  /**
   * Guard + dispatch one MessageEvent. Validated messages are forwarded to
   * their handler with `direction` and `token` stripped; unvalidated or
   * unknown-type messages are silently dropped.
   */
  handle(event: MessageEventLike): void;
}

/** Build a guard-then-dispatch seam for one world. */
export function createMessageDispatcher(opts: MessageDispatcherOptions): MessageDispatcher {
  const selfWindow = opts.selfWindow ?? window;
  return {
    handle(event: MessageEventLike): void {
      const expectedToken = typeof opts.token === "function" ? opts.token() : opts.token;
      if (!shouldProcessPageMessage(event, expectedToken, selfWindow, opts.direction)) return;
      const data = event.data as Record<string, unknown>;
      const type = data?.type;
      if (typeof type !== "string") return;
      const handler = opts.handlers[type];
      if (!handler) return;
      const msg = { ...data };
      delete msg.direction;
      delete msg.token;
      handler(msg);
    },
  };
}
