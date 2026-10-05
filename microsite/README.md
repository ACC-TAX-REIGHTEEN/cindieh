# Cindieh microsite

Landing page (one-pager) for the Cindieh extension, plus the public privacy
policy. Indonesian, matching the project's user-facing language split.

## Architecture: static, no build step

Plain HTML + CSS + vanilla JS, split into files and served as-is. This is a
deliberate match for the extension itself (vanilla DOM/CSS, no UI framework,
minimal dependencies): no bundler, no framework, no `node_modules` for the
site. Any static host works (GitHub Pages, Netlify, a subfolder of an existing
site) because **every asset path and every cross-page link is relative**.

The site is deployed at `https://cindieh.pages.dev`, so the absolute URLs a
crawler needs — `canonical`, `og:url`, and the absolute `og:image` — are
written out by hand and checked against each other by the test suite (see
[The hostname lives in four places](#the-hostname-lives-in-four-places)).

## Structure

```
microsite/
├── index.html                 # the whole page (semantic sections, JSON-LD)
├── privacy.html               # public privacy policy (store submissions)
├── 404.html                   # Cloudflare Pages fallback; needs <base href="/">
├── _headers                   # Cloudflare Pages cache + security rules
├── robots.txt                 # allow all, points at the sitemap
├── sitemap.xml                # the two indexable URLs
├── assets/
│   ├── css/microsite.css      # design system + components (cream/ink theme)
│   ├── fonts/                 # self-hosted woff2, Latin subset
│   ├── js/microsite.js        # scroll-reveal + keyboard tab navigation
│   └── img/
│       ├── icon-16/32/48/128.png   # copied from ../icons/ (extension icons)
│       ├── apple-touch-icon.png    # 180x180 render of icon-128
│       └── og.jpg                   # 1200x630 social card
└── README.md
```

## Conventions

- **Content mirrors the repo.** Feature descriptions, permissions, prefixes,
  shortcuts, the supported page list, the status labels of both result grids,
  the generated export filenames, and the popup controls are copied from
  `README.md`, `manifest.json`, `popup/popup.html`, and the source. When those
  change, this page must change with them —
  `src/tests/microsite-sync.unit.test.ts` fails the build when it doesn't. Each
  fact is checked **inside its own container** on this page (the prefix table,
  the permission table, the tab panel that owns it, `.pref-table`), because the
  prose repeats many of these words; several of the facts are also checked in
  reverse, so nothing here may advertise a page, status, or control the code
  does not have.
- **Feature tabs are CSS-only** (radio technique) so they work without
  JavaScript; tab inputs are hidden but focusable, never `display:none`.
  `microsite.js` upgrades the radio group into a real ARIA tablist — it moves
  `role="tab"`/`aria-selected`/`aria-controls` onto the **labels**, retires the
  radios from both the accessibility tree and the tab order together, and adds
  roving `tabindex`. All of that is enhancement: with scripting off the radios
  keep native semantics and the page still works.
  - Two rules make that true rather than assumed. The reveal styles are scoped
    to `.js` (set by an inline script in `<head>`), because an unscoped
    `.reveal` would leave every section at `opacity:0` forever for anyone
    without JavaScript. And the label `click` handler calls `preventDefault()`,
    because the native label-to-radio hand-off would otherwise move focus onto
    the hidden radio and drop a keyboard user out of the tab strip.
- **`prefers-reduced-motion` is honoured in JS, not only in CSS.** The reveal
  skips its `IntersectionObserver` entirely rather than animating and letting
  the media query undo it afterwards.
- **One `<main>`, and a skip link that actually skips.** The landing page had
  nine `<section>`s and nothing wrapping them, so there was no main landmark
  to jump to and a keyboard user had to tab through the topbar's eight links
  before reaching any content. `index.html` and `404.html` now wrap their body
  in `<main>`; `privacy.html` already had one. The topbar became a `<header>`
  in the same change, because it used to be a `<div>` and the only `<header>`
  was the hero — which has just moved *inside* `<main>`, where a `<header>` is
  no longer a banner. Changing the element first is what keeps the landmark.
  `<main id="konten" tabindex="-1">`: the `tabindex` is load-bearing, because
  without it the skip target is not focusable and the link only scrolls while a
  screen reader keeps reading from the topbar.

  The skip link is the first thing in `<body>`, and "first" is the whole claim:
  one behind eight links is not a skip link. `microsite-sync.unit.test.ts`
  asserts each page has exactly one `<main>`, that **nothing focusable precedes
  the skip link**, and that its `href="#…"` target exists. A page is only
  *required* to have one when focusable content precedes its `<main>`, which is
  why `privacy.html` legitimately has none — there, `<main>` is already the
  first element and a skip link would jump nowhere.

  Both guards that scan the DOM's own vocabulary strip HTML comments first.
  An explanatory comment about a fix naturally names the element it changed
  (`<!-- the hero moved inside <main> -->`), and the landmark guard reddened
  itself on the commit that added it by counting that as a second `<main>`.

  The skip link reuses `.btn`/`.btn-primary` so its contrast pair is one the
  page already proves, and that reuse needed one guard of its own: the button
  hover nudge is `.btn:hover{transform:translateY(-1.5px)}`, which is exactly
  `(0,2,0)` — the same specificity as `.skip-link:focus` — and sits LATER in
  the file. A pointer resting near the top-left, which is where the skip link
  lands, would therefore win the cascade and nudge the link by a pixel and a
  half instead of revealing it, so a keyboard user would press Tab and see
  nothing happen. The hover rule is `.btn:not(.skip-link):hover` for that
  reason; **do not drop the `:not()`**, and note that under
  `prefers-reduced-motion` the reduced-motion override carries the same
  exclusion, because `transform:none` there would leave the link stuck visible.
- **Heading levels are pinned, because the outline is a contract.** The page
  shipped thirteen `<h4>`s sitting directly under `<h2>` section headings with no
  `<h3>` between them, so every screen reader announced a level it could not
  descend into. They are `<h3>`s now, with zero visual change (the reset covers
  both, and each rule sets its own `font-size`).
  `microsite-sync.unit.test.ts` reads each page's headings **in document order**
  and fails on a skipped level, on more than one `h1`, and on sibling subheads
  that disagree with each other. Three separate counterfactuals shaped it, and
  the middle one is the reason it is not just a "no jump" check: demoting a
  *single* subhead among its siblings yields `h3, h3, h4, h3` — no jump
  anywhere in that sequence, which the obvious rule passes. The sibling check
  is the only thing that catches it.
  Promoting those subheads also renamed `.feat-side h4` and `.install-card h4`,
  and `TEXT_PAIRS` **skips any label that no longer resolves to a rule** — so
  renaming the stylesheet rule alone left the suite green with thirteen subheads
  rendering at the browser default. Both rules are therefore pinned directly,
  including an assertion that no `.feat-side h4` rule survives. Fixing that skip
  in general needs a way to tell a real selector from a prose reading
  (`.eyebrow on alt-bg`, `.btn-primary label`), which "starts with a dot" does
  not do — so it stays a documented limitation rather than a wrong heuristic.
- **The legal copy is guarded in the opposite direction.** Every other check
  here catches the page drifting away from the code. `LEGAL_COMPLIANCE.md` is a
  document instead, so nothing compared the page against the audit it cites: the
  legality FAQ used to answer *"belum bisa dijawab pasti di sini"* and the
  footer called the page a preview, for a review the repository had already
  concluded clean on both Pasal 30 and Pasal 32 UU ITE. A reader deciding
  whether to install an extension on a government portal was told "unknown".
  The suite now parses the audit's `**Kesimpulan**` lines and requires the FAQ
  to name every article they cover, forbids the "still under review" wording
  outright, and cites the audit from both the FAQ and the footer. Two properties
  make it durable: the articles are **parsed, not hand-listed**, so a new one in
  the audit reddens the build until the page names it too; and a conclusion that
  stops finding Cindieh compliant also reddens it, because the copy would then
  be claiming a clean bill of health the audit no longer gives.
- **`privacy.html` is a real page, not a file in the repo, because a store
  listing cannot link to GitHub.** Chrome Web Store and Firefox Add-ons both
  ask for a privacy policy **URL** at review time, so it lives at
  `https://cindieh.pages.dev/privacy.html` next to the landing page. Its
  content is derived from what the code actually does — no server, no
  telemetry, no analytics, one host — and its permissions table is checked
  against `manifest.json` **in both directions** by `microsite-sync.unit.test.ts`:
  every permission the manifest requests must be named on the page, and every
  permission the page claims must exist in the manifest. A fifth permission
  cannot go out undeclared. The page shares the landing page's origin, is listed
  in `sitemap.xml`, and is linked from the footer with a **relative** path, so
  the folder still works from a subdirectory.
- **Icons are copies of `../icons/`.** If the extension icon is redesigned,
  re-copy the four PNGs and re-render `apple-touch-icon.png` / `og.jpg`
  (both were produced by drawing `icon128.png` on a 180px/1200x630 canvas —
  the og card adds the title, feature line, and chips in the site's fonts).
- **Type is self-hosted, subsetted, and metric-matched.** `assets/fonts/`
  holds five woff2 files: Space Grotesk and IBM Plex Sans as *variable* faces
  (one file each covers 400–700), and IBM Plex Mono at 400/500/600 because it
  has no variable cut. All are the Latin subset. The `@font-face` block at the
  top of the stylesheet also declares a metric-matched fallback per family —
  the overrides come from the fonts' own OS/2 tables, so `font-display: swap`
  does not move the line boxes. **Adding a weight means editing that block, not
  adding a file.** Requesting them from Google Fonts instead cost 309 KB over
  12 requests to two third-party origins, against 111 KB over 5 same-origin
  requests now.
- **The social card is JPEG, on purpose.** A lossless PNG of the same card is
  122 KB (the anti-aliased type alone uses 2,744 colours), and WebP is not
  reliably supported for `og:image` — LinkedIn in particular. JPEG at q=0.85 is
  67 KB at PSNR 37.7 dB, and a link preview shows it at half size anyway.
- **The palette is a mirror of the extension's, and text lives one step
  darker.** The site depicts the product, so ten base tokens are byte-identical
  copies of `../styles/injected.css` (`--match`↔`--ch-match` `#2F6F5E`,
  `--diff`↔`--ch-diff` `#B8842F`, `--bad`↔`--ch-bad` `#B23A2E`,
  `--only-ct`↔`--ch-blue` `#3E5D8A`, `--miss`↔`--ch-text-muted` `#8A8677`,
  `--ink-soft`↔`--ch-text-dark`, `--card`↔`--ch-white`, `--paper`↔`--ch-paper`,
  `--paper-alt`↔`--ch-paper-alt`, `--stamp`↔`--ch-primary` `#C23B22`). Those
  hues were chosen as **fills**, and as text on their own 12–14% tints they
  measured 2.4:1 to 4.2:1 — a clear WCAG AA failure. Each status colour
  therefore has a `-ink` twin: the same hue and saturation with only the
  lightness reduced, solved to clear **5:1** against its tint on both `--paper`
  and `--card`. The margin over AA's 4.5 is deliberate, so a rounding change
  cannot silently put a pair back under the line.

  | Role | Base (fills, borders, swatches) | Text-safe | Was | Now |
  |---|---|---|---|---|
  | match | `--match` `#2F6F5E` | `--match-ink` `#296152` | 4.20:1 | 5.10:1 |
  | diff | `--diff` `#B8842F` | `--diff-ink` `#72521D` | 2.41:1 | 5.23:1 |
  | bad | `--bad` `#B23A2E` | `--bad-ink` `#9A3228` | 4.16:1 | 5.14:1 |
  | miss | `--miss` `#8A8677` | `--miss-ink` `#5D5A50` | 2.65:1 | 5.02:1 |
  | only Coretax | `--only-ct` `#3E5D8A` | `--only-ct-ink` `#3E5D8A` | 5.17:1 | 5.17:1 |

  **The rule: `-ink` owns every `color:`; the base token keeps every
  `background:`, border and swatch.** `--only-ct` needed no darkening and
  `--only-ct-ink` is simply an alias — the rule stays uniform so nobody has to
  remember which hues happened to be dark enough.
- **`--line-strong` is a hairline; `--control-line` is a control boundary.**
  WCAG 1.4.11 wants 3:1 for anything that identifies a control, and
  `--line-strong` (`rgba(27,36,54,0.28)`) measures 1.75:1 on paper. Card edges
  and table rules are decorative and may keep it; the borders of `.btn-ghost`
  and `.ct-input` may not, so they draw `--control-line`
  (`rgba(27,36,54,0.55)`, 3.3–3.5:1). Pill swatch dots stay on the base hues:
  they are decorative-redundant with the label beside them.
- **Contrast is a test, not a review.** `microsite-sync.unit.test.ts` computes
  WCAG 2.1 ratios in the suite itself — 86 rendered text pairs (4.5:1 normal,
  3:1 large), the literal `rgba()` in `.code-block .cmt`, and the three control
  borders at 3:1 — and fails the build on any regression. It also re-checks the
  ten-token mirror against `injected.css` in both directions, so a change to
  either side has to be deliberate, and it fails on any `color: var(--match)`
  written against a base hue instead of its `-ink` twin.

  `404.html` is included because it carries its **own** `<style>` block, and
  that is exactly how `.nf .code` slipped through at 4.42:1 while the table
  still showed `--stamp` as covered elsewhere. A fifth guard therefore checks
  the table against the source: for every entry whose label is a real selector,
  the rule block must still name the token the table claims to have tested —
  so swapping a passing `-ink` back for a failing base hue goes red even though
  every token-level assertion still passes. Adding a colour means adding the
  pair to `TEXT_PAIRS`.

## Deploy

Hosted on **Cloudflare Pages**, which needs no build step at all:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `microsite` |
| Root directory | *(repository root)* |

The repo root `README.md` links back to this folder, and the [`CI`](.github/workflows/ci.yml)
workflow runs `src/tests/microsite-sync.unit.test.ts` — it is one of the test
files in `pnpm test` — on every push and every pull request. Editing this page
or the code it documents therefore fails the build rather than quietly drifting.

Everything in this folder is served exactly as committed. Three files only do
anything because Cloudflare Pages recognises them by name:

- **`_headers`** — cache and security rules. The fonts get a one-year
  `immutable` cache (there is no bundler to hash filenames, so a font change
  means renaming the file); the HTML is `max-age=0, must-revalidate` so a
  hand-edited canonical can never be served stale.
- **`404.html`** — served for any missing path.
- **`robots.txt` / `sitemap.xml`** — plain files, no framework involved.

### The hostname lives in four places

There is no build step to inject a site URL, so `https://cindieh.pages.dev/`
is written out by hand in the `<link rel="canonical">`, in `og:url`, in
`sitemap.xml`, and in the `Sitemap:` line of `robots.txt` — and now once more in
each of the two pages' canonical and social tags, so moving the site means
editing all of them. Asset paths and every link **between the pages** stay
**relative** so the folder still works from a subdirectory; only the host
references above need to be absolute.

`src/tests/microsite-sync.unit.test.ts` asserts all of them agree, that each
canonical is absolute HTTPS and on one shared origin, that `sitemap.xml` lists
every canonical page and nothing else (both directions, so no page is unlisted
and no `<loc>` is a dead link), that the 404 keeps its `<base href="/">`, that
every cross-page link is relative *and* points at a file that exists, and that
no `__SITE`/TODO placeholder is left behind. Moving or renaming a page is
therefore one deliberately failing test rather than several silently stale tags.

## Preview

Open `index.html` directly, or serve the repo root with any static server,
e.g.:

```bash
npx serve .
# → http://localhost:3000/microsite/
```

Prefer the server over `file://`: the pages preload their own fonts and fetch a
same-origin stylesheet, and a `file://` origin will silently skip both, which
makes the page render in a fallback serif. The 404 page is the exception worth
checking by hand, since its whole job is behaving correctly on a deep path:
request `/microsite/404.html` style paths and confirm its assets still resolve
thanks to `<base href="/">`.
