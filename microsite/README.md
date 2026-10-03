# Cindieh microsite

Landing page (one-pager) for the Cindieh extension. Indonesian, matching the
project's user-facing language split.

## Architecture: static, no build step

Plain HTML + CSS + vanilla JS, split into files and served as-is. This is a
deliberate match for the extension itself (vanilla DOM/CSS, no UI framework,
minimal dependencies): no bundler, no framework, no `node_modules` for the
site. Any static host works (GitHub Pages, Netlify, a subfolder of an existing
site) because **every asset path is relative**.

The hosting domain is not decided yet, so `og:url`, `canonical`, and absolute
`og:image` are intentionally absent — there is a marked HTML comment in
`index.html` where they belong once the domain exists.

## Structure

```
microsite/
├── index.html                 # the whole page (semantic sections, JSON-LD)
├── 404.html                   # Cloudflare Pages fallback; needs <base href="/">
├── _headers                   # Cloudflare Pages cache + security rules
├── robots.txt                 # allow all, points at the sitemap
├── sitemap.xml                # the single indexable URL
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
- Keep the design tokens in `:root` aligned with the extension's
  `--ch-primary` (`#C23B22`), which the toolbar mockup mirrors.

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
`sitemap.xml`, and in the `Sitemap:` line of `robots.txt`. Asset paths inside
the pages stay **relative** so the folder still works from a subdirectory —
only the four host references above need to be absolute.

`src/tests/microsite-sync.unit.test.ts` asserts all four agree, that the
canonical is absolute HTTPS, that `og:image` resolves to the same host, that
the 404 keeps its `<base href="/">`, and that no `__SITE`/TODO placeholder is
left behind. Moving the site is therefore one deliberately failing test rather
than three silently stale tags.

## Preview

Open `index.html` directly, or serve the repo root with any static server,
e.g.:

```bash
npx serve .
# → http://localhost:3000/microsite/
```
