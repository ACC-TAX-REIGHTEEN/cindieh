# Scraper injection is one-time per page; the script element stays as the marker

`injectScraper` (`main.ts`) previously removed the injected `<script id="__ch_scraper_injected__">` element as soon as it loaded. Because SPA navigation re-calls `injectScraper` without a page reload, each navigation created a new scraper instance while old instances lingered. A stale instance's bridge token was no longer current — `shouldProcessPageMessage` rejected its messages — but its monkey-patched `fetch`/XHR/`URL.createObjectURL` interceptors stayed chained beneath the newer instance's wrappers. These zombie interceptors could interfere with native-download blocking and stacked wrappers on every navigation.

Now the element is retained after load: `scraper.ts` strips `src` (and with it the token) as its first action, and the element — id intact, `src` gone — stays in the DOM. `injectScraper`'s `getElementById("__ch_scraper_injected__")` guard therefore holds for the whole page lifetime: exactly one scraper instance per page. The single instance is reset on every navigation via `RESET_SCRAPER`, and the bridge token is generated once per page instead of once per navigation.

Load-failure handling: if the script fails to load (CSP/network), `main.ts`'s `onerror` removes the element so injection can be retried — which also drops the token-bearing `src` early.

Security note: the token-in-`src` exposure window (appendChild → `scraper.ts` removing `src`) is unchanged by this decision; the element is retained only as the id marker and never holds the token after load.

Status: accepted.
