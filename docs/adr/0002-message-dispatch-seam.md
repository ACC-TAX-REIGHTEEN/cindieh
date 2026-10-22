# Cross-world messaging is a guard-then-dispatch seam per world

`main.ts` and the MAIN world each run one `createMessageDispatcher` (from `postmessage-guard.ts`; the MAIN world's is created in `scraper-install.ts` since ADR-0038, `scraper.ts` being now the adapter) — a guard (source, origin, direction, token) followed by a handler table keyed by message `type`. Adding a message type means one handler-table entry in the world that receives it. The scraper's two hand-written FROM_CONTENT listeners and the dead `runtime.onMessage` channel (no sender existed; the popup's real seam is `storage.local`) were removed.

Do not reintroduce ad-hoc `window.addEventListener("message", ...)` listeners with inline guard checks — the security gate is tested once here and applied to both directions.

Status: accepted.
