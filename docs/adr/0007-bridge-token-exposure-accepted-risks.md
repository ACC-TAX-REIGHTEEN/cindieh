# Bridge token exposure in postMessage payload and script URL is an accepted risk

The bridge token is exposed twice while crossing from the isolated world into the MAIN world, and both exposures are accepted:

1. **postMessage payload** — `postToScraper` (`bridge.ts`) attaches the token as a plaintext `token` field on every message sent into the page, and `sendToContent`/`emitPdfDownload` (`scraper.ts`) do the same on the way back. Any MAIN-world script that has installed `window.addEventListener("message", ...)` can read it from `event.data.token`.
2. **Script URL** — `injectScraper` (`main.ts`) passes the token to the scraper via `?token=` on the injected `<script src>`. The token is observable in the shared DOM until scraper initialization removes `src`. The element and its id remain as the one-time injection marker (ADR-0008); load failure removes the element to allow retry. Script loading and scheduling determine the attribute's lifetime; there is no guaranteed sub-frame exposure window.

Both are inherent to the two-worlds architecture, not accidents to be fixed away:

- The MAIN-world scraper has no extension runtime API; `postMessage` remains the chosen channel between the worlds.
- The token has to reach the scraper somehow, and the script URL is the documented mechanism that keeps it off `window`.

Threat model: MAIN-world code shares the DOM and page message traffic and can observe the token. The token therefore is not secret authentication against hostile same-page scripts, including other extensions' page-injected code. Existing access to page data does not imply that invoking extension-side handlers adds no capability; the bridge must not be described as granting nothing beyond page access.

The token correlates messages with the current bridge and rejects messages with missing or mismatched tokens. `shouldProcessPageMessage` also checks source, origin, and direction: source/origin bind the window and origin, not the JavaScript world, and direction is a protocol field rather than proof of sender identity. These checks do not establish that a message came from the intended scraper or content script in the presence of hostile same-page code.

Decision: retain the two-worlds architecture, token validation, and guard-then-dispatch seam with this limitation accepted. This is not a claim of protection against hostile same-page message forgery.

Required validation and exposure hygiene:

- Do not store the token on `window`. The scraper removes `src` during initialization but retains the element and id as the one-time injection marker (ADR-0008). This reduces DOM exposure; it does not guarantee secrecy or erase exposure through subsequent messages.
- `shouldProcessPageMessage` validates `event.source`, origin, token, and direction for every message — do not weaken it, and do not reintroduce ad-hoc message listeners (ADR-0002).
- Do not log the token, persist it, or expose it via any debug hook.

Status: accepted.
