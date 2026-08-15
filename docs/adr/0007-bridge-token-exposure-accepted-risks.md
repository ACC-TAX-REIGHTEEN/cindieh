# Bridge token exposure in postMessage payload and script URL is an accepted risk

The bridge token is exposed twice while crossing from the isolated world into the MAIN world, and both exposures are accepted:

1. **postMessage payload** — `postToScraper` (`bridge.ts`) attaches the token as a plaintext `token` field on every message sent into the page, and `sendToContent`/`emitPdfDownload` (`scraper.ts`) do the same on the way back. Any MAIN-world script that has installed `window.addEventListener("message", ...)` can read it from `event.data.token`.
2. **Script URL** — `injectScraper` (`main.ts`) passes the token to the scraper via `?token=` on the injected `<script src>`. Between `appendChild` and the moment `scraper.ts` strips `src`/`id` and removes the element, a MAIN-world script watching DOM mutations can read the token off the attribute.

Both are inherent to the two-worlds architecture, not accidents to be fixed away:

- The MAIN world has no `browser.runtime`, so `chrome.runtime.sendMessage` is unavailable there; `postMessage` is the only sanctioned channel between the worlds.
- The token has to reach the scraper somehow, and the script URL is the documented mechanism that keeps it off `window`.

Threat model: reading the token requires already running arbitrary script in the MAIN world — at which point page content, XHR/fetch, and DOM are readable anyway, and the token grants nothing beyond what that script could already do. The token's actual job is preventing *unrelated* MAIN-world scripts (other extensions, page-injected code) from forging `START_SCRAPE` / `DOWNLOAD_PDF_ITEM`; those scripts' capabilities are unchanged by seeing the token, and the per-message validation in `shouldProcessPageMessage` still binds every message to the correct world and direction.

Mitigations that remain load-bearing:

- The token is never stored on `window`; the scraper reads it from its own `<script>` element and immediately removes `src`/`id` and the element itself (the URL window is sub-frame).
- `shouldProcessPageMessage` validates `event.source`, origin, token, and direction for every message — do not weaken it, and do not reintroduce ad-hoc message listeners (ADR-0002).
- Do not log the token, persist it, or expose it via any debug hook.

Status: accepted.
