# The MAIN world's install wiring takes the page as one injected environment

`scraper.ts` was an IIFE that read the page directly: `document`, `location`, `window.postMessage`,
`window.addEventListener`, `window.setTimeout`, `window.fetch`, `XMLHttpRequest.prototype` and
`HTMLAnchorElement.prototype`. Everything it decided was therefore decided in code no test could
reach:

| Decision | Why it mattered |
|---|---|
| the bridge token is read off its own `<script src>`, then the `src` is stripped | a second injection would be a second interceptor (ADR-0008) |
| each action runs under a per-run context that drops a message from another run or another page | a cancelled run must not report into the one that replaced it (ADR-0010) |
| `RESET_SCRAPER` clears the captured request, the filters, the invoice map and the subscribers | a stale capture is served onto the next page |
| an empty prefix response latches one not-found notice per field | the search must report once, not per request (ADR-0012) |
| teardown restores three surfaces independently | one refused assignment must not strand the other two |

The module sat at 39.4% statements / 28.1% branch, the lowest in the repo, and the only way to
exercise any of the above was to stub six globals. The boot harness did exactly that, which is why
it is 617 lines to prove "the adapter wired the real prototypes".

Decision:

1. **`scraper-install.ts` holds the wiring.** `installScraper(env)` does the installing and returns
   `{ teardown }`. Its body is the IIFE's, unchanged in order — the token and the capture state
   first (the XHR patches read them from the moment they are installed), the response-sabotage nets
   before the interceptors that can trigger them, and the `pagehide` listener only once everything
   it has to restore exists.
2. **`ScraperEnv` is the page, as one object**: the document, the window (its `location`, message
   channel, timers, `open`, and current `fetch`), a `setFetch` to replace that fetch, the two
   prototypes, and `isDevelopment`. The window is a HANDLE, not a copy: the message guard compares
   `event.source` against the object it is given, so `selfWindow` is `env.window` itself.
3. **`scraper.ts` is the adapter.** It builds `env` from the globals it actually has and calls
   `installScraper` once — nothing else. It is now the ONE place in the MAIN world allowed to name
   `window`, `document`, `fetch` or either prototype, which also makes it a fully covered adapter.
4. **Teardown is a returned value, not only an event.** `pagehide` still triggers it, so production
   behaviour is byte-for-byte the same; a test can also call it directly, and a second call after
   the browser has already restored everything is not an error.

Consequences: `scraper-install.ts` is driven by `scraper-install.unit.test.ts` over a fake env —
the token read and the stripped `src`, a message with the wrong token or from another origin being
dropped, a bulk PDF with no captured request answering the run that asked for it, an action with no
usable `runId` refused at the door, a navigation reset with nothing in flight, the per-surface
teardown isolation, and the development-only debug hook. The remaining half of the module is the
action BODIES (a real paginated scrape, a bulk PDF with a captured request), which are reachable
through the same seam and already have their own suites in `scraper-actions.unit.test.ts`; the
module's number is a starting floor, not a ceiling. `scraper-boot.unit.test.ts` keeps its 20 cases
and its purpose narrows to what only it can prove: the adapter handed the real prototypes to the
patches, and `pagehide` puts them back.

Status: accepted.
