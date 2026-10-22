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

## House style

Eleven rules the page is now held to, twelve entries if the nested one under the
grouped-lists rule is counted, and three of them are enforced by the suite: the
eyebrow budget, the no-em-dash rule for rendered text, and the
no-synthesised-italic rule. The other eight are house rules only, and it is worth
saying so plainly: nothing in `microsite-sync` checks a table's caption, a
`scope="rowgroup"`, a `lang="en"`, one card treatment per idea, or a section's
height, so those hold by review rather than by machine. All of them exist
because each one was a real habit of this page rather than a hypothetical
temptation: the redesign had to remove 11 eyebrows, 77 em-dashes, a synthetic
italic, a number sequence and a repeated card treatment before the layout read
as designed rather than assembled.

- **One eyebrow, spent in the hero.** A small-caps category label above every
  section headline is the single rhythm that makes a page read as a template,
  and this page had eleven of them for ten heads. The hero keeps its label
  because there the one thing a visitor cannot infer from the headline is what
  kind of thing the product is; everywhere else the section's position in the
  page already says what the section is. There is one now, over eight heads
  (seven sections plus the hero), and the budget is one per three heads, so
  three; `microsite-sync` counts both sides. The label also lost its decorative
  dot, which said nothing the words did not.
- **No em-dash in rendered text.** There were 77 across the three pages before
  the redesign (and one en-dash besides), almost all of them the same "X, Y" the
  comma already says; none are left, and the suite fails the build if one comes
  back. That is a historical count of what the redesign had to remove, not a
  count of what remains. Comments are exempt, which is what keeps the rule about
  the reader rather than the author; the JSON-LD is not exempt, because its FAQ
  answers are exactly the visible ones.
- **No italic that the fonts do not ship.** None of the five woff2 files is an
  italic cut, so every `<em>` was drawn as a *synthesised* oblique, which IBM
  Plex Sans renders visibly wrong at 14px. Emphasis is weight now: the sheet
  resets `em` to `font-style:normal` with a heavier weight, and the code
  identifiers that used to be set as `<em>` (`startswith`, `contains`,
  `case-sensitive`) left the page altogether when that copy was rewritten in
  plain Indonesian, so there is nothing left to set in mono.
- **One card treatment per idea.** The settings table is a card; the before /
  after table is a bare ruled table; the compliance block is one ruled row with
  an uneven first column and no numbering. Two adjacent sections sharing a
  treatment is what made them read as one section twice.
- **A section has to earn its height.** `#kompatibilitas` (three browser badges)
  and `#roadmap` (one card) were each a full 86px-padded section for content the
  install cards, the download row and `.dl-note` already said, and both sat on
  the same `--alt-bg` band as a neighbour, so folding them in cost no rhythm at
  all. What survived is one sentence each: the host restriction joined the
  install section's sub, and the store listing is now a status line under the
  download buttons. Seven sections, not nine.
- **Every table has a caption.** Eight of them on the landing page, all
  `.sr-only` (`.pref-table`, the five mini-tables including the `.grid-claims`
  table that names the Pengecekan columns per grid, the compare table and the
  permissions table), and the privacy policy's own permissions table carries one
  too, so the rule holds across the whole site. The cluster rows in
  `.pref-table` carry `scope="rowgroup"`. Without captions a screen reader in
  table-navigation mode had nothing to announce for any of them.
- **English UI literals carry `lang="en"`.** `Load unpacked`, `Mode Developer`,
  `Install Add-on From File…`, the store names. The page is `lang="id"`, and an
  Indonesian screen-reader voice mispronounces every one of them. The tags are
  invisible to `flat()`/`plain()`, so neither the JSON-LD FAQ equality check nor
  the popup-control checks can see them.
- **Only the cuts used above the fold are preloaded.** The two variable faces
  plus Plex Mono **400**. Mono 400 is there because the hero eyebrow and the
  mockup's address bar are mono and above the fold: this comment used to claim
  mono was "far below the fold", which was simply untrue, and the red uppercase
  line was swapping in after first paint. The 500 and 600 cuts stay unpreloaded
  because nothing uses them until much further down.
- **Long lists get grouped, not ruled.** The thirteen popup settings used to be
  thirteen rows of the same two columns, which asks the reader to hold thirteen
  rows at once. They are now four clusters following the popup's own sections,
  one divider per cluster instead of one per row, and a `<tbody>` per cluster so
  the gap can come from a heading. The suite's reverse check reads
  `<tr><td>` first cells, so a cluster row (which has a `class`) is invisible to
  it, exactly as it should be.
  - **One answer may be several paragraphs.** The legality FAQ used to be a
    single `<p class="faq-a">` holding all 944 characters, which made it the
    least scannable thing on the page. It is now three, one per legal ground,
    and not one word was cut. Both checks that read it had to widen too: they
    matched `<summary>…</summary><p class="faq-a">(.*?)</p>`, so they read only
    the FIRST paragraph and would have passed silently on a version that had
    lost the other two. They now read the whole `<details>` body.
- **The mobile nav is a strip, not a menu.** Below 760px the nav used to be
  `display:none`, which left a phone user with a download button and no way to
  reach any section except the footer's copy. It is now a second compact row
  that scrolls sideways: every destination is one swipe away, with no menu to
  open, no focus trap to keep honest, and no JavaScript.
- **Motion has to mean something.** The toolbar's five injected controls stagger
  in left to right, because the injection order is the point the mockup exists
  to make; everything else is hover and press feedback. `prefers-reduced-motion`
  covers all of it, `.ct-input` included, because a control left at `opacity:0`
  by a cancelled animation is worse than one that never animated.

## Conventions

- **Content mirrors the repo.** Feature descriptions, permissions, prefixes,
  shortcuts, the supported page list, the status labels of both result grids,
  the generated export filenames, and the popup controls are copied from
  `README.md`, `manifest.json`, `popup/popup.html`, and the source. When those
  change, this page must change with them —
  `src/tests/microsite-sync.unit.test.ts` fails the build when it doesn't. Four
  of those facts are checked **inside their own container** on this page (the
  prefix table, the permission table, the tab panel that owns the status
  legend, and `.pref-table`), because the prose repeats many of these words; the
  shortcut and export-menu-entry checks are page-wide, and several of the facts
  are also checked in reverse, so nothing here may advertise a page, status, or
  control the code does not have.
- **Feature tabs are CSS-only** (radio technique) so they work without
  JavaScript; tab inputs carry `.sr-only` (hidden but focusable, never
  `display:none`) plus the `opacity:0` the technique needs. One utility does the
  hiding for both the radios and anything else that needs it, rather than the
  rule being written out twice.
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
- **The `FAQPage` is generated from the visible FAQ, and the suite proves it.**
  The `ld+json` block is one `@graph` holding `SoftwareApplication` (now with
  `softwareVersion`, `downloadUrl`, `image`, `inLanguage`,
  `isAccessibleForFree`) and a `FAQPage` whose eleven entries come from the
  `<details>`/`<summary>` pairs. Nothing validated that block before, so it could
  have become invalid JSON — or kept claiming a version the extension stopped
  shipping — with no build step objecting.

  Google requires every `FAQPage` answer to be **visible on the page**, which is
  what makes this worth a guard: structured data that drifts from the markup
  describes text no visitor can see. The suite therefore parses both sides and
  asserts the question count matches, every visible question is present, and
  **each JSON-LD answer is exactly the text the page shows**. That last
  comparison is written the way it is on purpose. The first version checked the
  *visible* answer against the page — the page asserting it contains itself —
  and passed a counterfactual in which the structured answer had been edited
  into something the page never shows. Regenerate the entries from the
  summaries rather than hand-editing the JSON.

- **One `<main>`, and a skip link that actually skips.** The landing page had
  nine `<section>`s and nothing wrapping them, so there was no main landmark
  to jump to and a keyboard user has to tab through the topbar's six links
  before reaching any content. `index.html` and `404.html` now wrap their body
  in `<main>`; `privacy.html` already had one. The topbar became a `<header>`
  in the same change, because it used to be a `<div>` and the only `<header>`
  was the hero — which has just moved *inside* `<main>`, where a `<header>` is
  no longer a banner. Changing the element first is what keeps the landmark.
  `<main id="konten" tabindex="-1">`: the `tabindex` is load-bearing, because
  without it the skip target is not focusable and the link only scrolls while a
  screen reader keeps reading from the topbar.

  The skip link is the first thing in `<body>`, and "first" is the whole claim:
  one behind six links is not a skip link. `microsite-sync.unit.test.ts`
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
  outright, and cites the audit from both the FAQ and the footer. The forbidden
  wording is swept for on the privacy policy as well as the landing page: the
  landing page's own copy was corrected first, and the privacy policy kept
  saying the review was still under way until the sweep looked at it too. Two
  properties make it durable: the articles are **parsed, not hand-listed**, so a
  new one in the audit reddens the build until the page names it too; and a
  conclusion that stops finding Cindieh compliant also reddens it, because the
  copy would then be claiming a clean bill of health the audit no longer gives.
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
  measured 2.4:1 to 4.2:1 — a clear WCAG AA failure. Each of the four status
  colours therefore has a `-ink` twin: the same hue and saturation with only the
  lightness reduced, solved to clear **5:1** against its tint. The margin over
  AA's 4.5:1 is deliberate for those four, so a rounding change cannot silently
  put one of them back under the line.

  | Role | Base (fills, borders, swatches) | Text-safe | Was | Now |
  |---|---|---|---|---|
  | match | `--match` `#2F6F5E` | `--match-ink` `#296152` | 4.20:1 | 5.10:1 |
  | diff | `--diff` `#B8842F` | `--diff-ink` `#72521D` | 2.41:1 | 5.23:1 |
  | bad | `--bad` `#B23A2E` | `--bad-ink` `#9A3228` | 4.16:1 | 5.14:1 |
  | miss | `--miss` `#8A8677` | `--miss-ink` `#5D5A50` | 2.65:1 | 5.02:1 |
  | only Coretax | `--only-ct` `#3E5D8A` | `--only-ct-ink` `#3E5D8A` | 4.72:1 on `--paper`, 5.17:1 on `--card` | 4.72:1 on `--paper`, 5.17:1 on `--card` |

  The two columns are one hue's ratio against its own tint, before and after the
  twin, measured on `--paper` where the tint composites over the page. The four
  status hues also clear 5:1 on `--card` (5.59:1, 5.71:1, 5.64:1 and 5.49:1).
  `--only-ct` is the odd one out: that base hue already cleared AA on its own
  tint, so it needed no darkening, and `--only-ct-ink` is simply an alias. Its
  two numbers therefore differ, because the two surfaces differ: **4.72:1 on
  `--paper` and 5.17:1 on `--card`**, against AA's 4.5:1 floor. It is the one
  pair in the table that does not clear 5:1, and it clears AA on both surfaces
  anyway.

  **The rule: `-ink` owns every `color:`; the base token keeps every
  `background:`, border and swatch.** The rule stays uniform so nobody has to
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
  still showed `--stamp` as covered elsewhere. The privacy policy's own block
  is audited the same way now, which is what makes its two `.legal` entries
  (`.legal .none` and `.legal .stamp-note`) real checks instead of labels the
  audit skipped. A fifth guard therefore checks
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

The repo root `README.md` links back to this folder, and the [`CI`](../.github/workflows/ci.yml)
workflow runs `src/tests/microsite-sync.unit.test.ts` — it is one of the test
files in `pnpm test` — on every push to `main` and every pull request (the same
workflow also runs `test:coverage`, both browser builds, and `package`). Editing this page
or the code it documents therefore fails the build rather than quietly drifting.

Everything in this folder is served exactly as committed. Four of the files here
only do anything because Cloudflare Pages recognises them by name:

- **`_headers`** — cache and security rules. The fonts get a one-year
  `immutable` cache (there is no bundler to hash filenames, so a font change
  means renaming the file); the HTML is `max-age=0, must-revalidate` so a
  hand-edited canonical can never be served stale. The stylesheet and script get
  `max-age=86400, must-revalidate`, which is the same reasoning pointed the other
  way: they are hand-edited too, so making them immutable would pin a corrected
  file for a year of returning visitors. Without their own rule they fell
  through to the `/*` catch-all and were revalidated on **every** page view —
  about 38 KB (the stylesheet is ~34 KB and the script ~5 KB), which is why
  `microsite-sync` asserts they have a rule, that it
  revalidates, and that it is not `immutable`.
- **`404.html`** — served for any missing path.
- **`robots.txt` / `sitemap.xml`** — plain files, no framework involved.

And one claim the landing page makes has a guard of its own:

- **The toolbar mockup is one `role="img"`, not a list of buttons.** It reads
  like a literal toolbar, and for a while it was announced as one — with two
  items silently missing, because the icon-only buttons were labelled by `title`
  alone. `title` is not reliably announced and cannot be focused, so there was no
  way to reach those two labels at all. The mockup is an *illustration*, so it
  is now one labelled image and the fake controls inside are presentation. The
  visible caption is unchanged; the `aria-label` carries the same claim for
  anyone who cannot see it. `microsite-sync` fails on any element that reaches
  for `title` as its only label, so the pattern cannot come back.

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
