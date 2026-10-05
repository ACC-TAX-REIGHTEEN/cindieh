// ============================================================
// MICROSITE-SYNC.UNIT.TEST.TS — the microsite may not drift from the code
//
// `microsite/index.html` copies facts that live in TypeScript: filename
// prefixes, manifest permissions, keyboard shortcuts, the list of portal pages,
// the status labels of the comparer and the accuracy checker, the generated
// export filenames, and every popup control. Nothing in the build fails when
// one of those moves, so this suite is the thing that fails instead: add an
// export source, a permission, a shortcut, a portal path, a status, a filename
// or a preference to the code and the microsite test goes red until the page is
// updated too.
//
// The comparison is deliberately TEXT-level on the microsite side (it is a
// static page, not a module) and API-level on the code side, so the assertions
// come from the real sources of truth rather than a copy of them:
// `export-source.ts`, `manifest.json`, `shortcuts.ts`, `page-context.ts`,
// `comparer-logic.ts`, `exporter.ts`, `downloader.ts`, `popup/popup.html`, and
// `src/shared/extension-preferences.ts`. A few facts — the shortcut keys, the
// checker's filter menu, the download extensions, the popup's own labels — are
// built imperatively with no exported array to import, so they are read from
// their source and every parser fails loudly when it finds nothing.
// ============================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getExportSourceSpec } from "../content/export-source";
import { isSupportedExportPage, describePortalPage } from "../content/page-context";
import type { ExportSource } from "../content/page-context";
import { getStatusLabel } from "../content/comparer-logic";
import { generateDynamicFilename } from "../content/exporter";
import { generateOutputTaxFilename, generateWithholdingFilename } from "../content/downloader";
import {
  COMPARISON_STATUSES,
  DEFAULT_BULK_CONFIRM_THRESHOLD,
  DELAY_PRESET_MULTIPLIER,
  NEVER_CONFIRM_THRESHOLD,
  normalizeFilenamePrefix,
} from "../shared/extension-preferences";

// ── Fixtures, read from disk on every run ──────────────────────────────────

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

interface ManifestShape {
  readonly permissions?: readonly string[];
  readonly optional_permissions?: readonly string[];
  readonly host_permissions?: readonly string[];
}

const microsite = read("../../microsite/index.html");
const micrositeCss = read("../../microsite/assets/css/microsite.css");
const manifest: ManifestShape = JSON.parse(read("../../manifest.json"));
const shortcutsSource = read("../content/shortcuts.ts");
// Hosting support files. Cloudflare Pages serves 404.html for any missing path,
// `_headers` sets the cache rules, and robots/sitemap carry the hostname.
const notFoundPage = read("../../microsite/404.html");
const privacyPolicy = read("../../microsite/privacy.html");
const pageHeaders = read("../../microsite/_headers");
const robotsTxt = read("../../microsite/robots.txt");
const sitemapXml = read("../../microsite/sitemap.xml");
// The published legal audit. The page cites it twice (the legality FAQ and the
// footer both send a reader there), so it is read here as a source of truth in
// its own right. See the "legal copy" block at the end of this file.
const legalCompliance = read("../../LEGAL_COMPLIANCE.md");
const uiComparerSource = read("../content/ui-comparer.ts");
const comparerExportSource = read("../content/comparer-export.ts");
const exporterSource = read("../content/exporter.ts");
const popupHtml = read("../../popup/popup.html");

/**
 * The page sets its prefixes in typographic dashes (FPK‑) while the code uses
 * plain hyphens (FPK-), and `&amp;` entities survive in the raw HTML. Fold
 * both so a comparison failure means a real content difference, not typography.
 */
const flat = (text: string): string =>
  text
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&times;/g, "\u00d7")
    .replace(/\s+/g, " ");

const page = flat(microsite);

/**
 * Markup, minus its comments. Both guards that scan the DOM's own vocabulary
 * need this: an explanatory comment about a fix naturally names the element it
 * changed ("<!-- the hero moved inside <main> -->"), and counting that as a
 * second <main> punishes the documentation for existing. Caught by the
 * landmark guard reddening itself on its own commit.
 */
const stripComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, "");

/**
 * Both facts are searched INSIDE their own table rather than page-wide: the
 * page says "BP-" and "storage" in other places too (a sample PDF name, the
 * FAQ), and a page-wide search would keep passing after the table itself went
 * stale — which is exactly the drift this suite exists to catch.
 */
const prefixTable = flat(
  microsite.match(/nama file \(\d+ sumber\)[\s\S]*?<table class="mini-table">[\s\S]*?<\/table>/)?.[0] ??
    "",
);
const permTable = flat(microsite.match(/<table class="perm-table">[\s\S]*?<\/table>/)?.[0] ?? "");

/**
 * The same scoping rule as above, for the facts that live inside a feature tab
 * or the settings table: the status labels appear in BOTH the comparer and the
 * checker legend, and "Nama file" is mentioned in prose all over the page, so a
 * page-wide `includes` would pass even if the one legend went stale.
 */
const rawPrefTable = microsite.match(/<table class="pref-table">[\s\S]*?<\/table>/)?.[0] ?? "";
const prefTable = flat(rawPrefTable);

/**
 * One tab panel's inner markup, addressed by its `id` (p1 … p7). Splitting on
 * the panel marker bounds every panel at the NEXT one; the last panel is cut at
 * the following `<section>` instead, so it cannot absorb the settings table and
 * the FAQ below it.
 */
const tabPanels = microsite.split('<div class="tab-panel"').slice(1);

const panel = (id: string): string => {
  const chunk = tabPanels.find((part) => part.startsWith(` id="${id}">`));
  if (!chunk) return "";
  const stop = chunk.indexOf("<section");
  return flat(stop === -1 ? chunk : chunk.slice(0, stop));
};

/** The `.status-legend` pill row of one tab panel. */
const statusLegend = (id: string): string =>
  panel(id).match(/<div class="status-legend">([\s\S]*?)<\/div>/)?.[1] ?? "";

/**
 * `ui-comparer.ts` declares its two filter menus as inline `{ value, label }`
 * tables and reads them with `document.createElement`, so there is no exported
 * array to import. They are read from the source instead — and a parser that
 * finds nothing says so rather than passing silently (see the shortcut suite).
 */
const parseFilterOptions = (variable: string): readonly { value: string; label: string }[] => {
  const body =
    uiComparerSource.match(new RegExp(`const ${variable}[^=]*= \\[([\\s\\S]*?)\\n\\s*\\];`))?.[1] ?? "";
  return [...body.matchAll(/\{ value: "([A-Za-z_]+)", label: "([^"]+)" \}/g)].map((m) => ({
    value: m[1],
    label: m[2],
  }));
};

/**
 * The names the two result grids are written under, in BOTH formats, read from
 * comparer-export.ts — the single place the basenames and the extensions now live.
 * They used to be literals at the two downloadXLSXFile() call sites in
 * ui-comparer.ts and moved to a declaration when CSV was added. A guard that
 * kept regexing the old location would have gone quiet on the move instead of
 * reporting it, which is the failure mode this suite exists to prevent.
 */
const resultExportExtensions = [
  ...comparerExportSource.matchAll(/\b(?:xlsx|csv):\s*"(\.[a-z0-9]+)"/g),
].map((m) => m[1]);

/** Each result grid's tab panel id -> every full filename that grid may write. */
const resultExportFilenames = new Map<string, string[]>(
  ([
    ["COMPARISON_EXPORT_BASENAME", "p5"],
    ["CHECKER_EXPORT_BASENAME", "p6"],
  ] as const).map(([constant, tab]) => {
    const basename =
      comparerExportSource.match(new RegExp(`const ${constant}[^=]*= "([^"]+)"`))?.[1];
    if (!basename) {
      throw new Error(`${constant} not found in comparer-export.ts — update this suite`);
    }
    return [tab, resultExportExtensions.map((ext) => `${basename}${ext}`)] as const;
  }),
);

/**
 * `exportXLSX`/`exportCSV` append the extension at the download call site, so
 * the extension the page shows in its samples is read from there rather than
 * assumed — a renamed extension has to move the page with it.
 */
const downloadExtension = (trailer: string): string | undefined =>
  exporterSource.match(new RegExp("`\\$\\{filename\\}(\\.[a-z0-9]+)`, " + trailer))?.[1];

/** Every source the export table declares — the union, written out once. */
const EXPORT_SOURCES: readonly ExportSource[] = [
  "OUTPUT_TAX",
  "INPUT_TAX",
  "OUTPUT_RETURN",
  "INPUT_RETURN",
  "SPT_A2",
  "SPT_B2",
  "PPH_21_L1A",
  "PPH_21_L1B",
  "PPH_21_L2",
  "PPH_21_L3",
  "WITHHOLDING_SLIPS",
];

const PORTAL = "https://coretaxdjp.pajak.go.id";

/** Portal URLs `page-context.ts` supports, each with the path the page shows. */
const SUPPORTED_PAGES: readonly { readonly url: string; readonly path: string }[] = [
  { url: `${PORTAL}/e-invoice-portal/output-tax`, path: "/e-invoice-portal/output-tax" },
  { url: `${PORTAL}/e-invoice-portal/input-tax`, path: "/e-invoice-portal/input-tax" },
  { url: `${PORTAL}/e-invoice-portal/output-return`, path: "/e-invoice-portal/output-return" },
  { url: `${PORTAL}/e-invoice-portal/input-return`, path: "/e-invoice-portal/input-return" },
  {
    url: `${PORTAL}/returnsheets-portal/value-added-tax-return`,
    path: "/returnsheets-portal/value-added-tax-return",
  },
  {
    url: `${PORTAL}/returnsheets-portal/article-21-26-tax-return`,
    path: "/returnsheets-portal/article-21-26-tax-return",
  },
  {
    url: `${PORTAL}/withholding-slips-portal/my-withholding-slips`,
    path: "/withholding-slips-portal/my-withholding-slips",
  },
];

// ── Filename prefixes ──────────────────────────────────────────────────────

describe("microsite — filename prefixes", () => {
  it("documents the prefix of every export source", () => {
    for (const source of EXPORT_SOURCES) {
      const { prefix } = getExportSourceSpec(source);
      expect(
        prefixTable.includes(prefix),
        `the microsite filename table is missing the "${prefix}" prefix for ${source}`,
      ).toBe(true);
    }
  });

  it("counts the sources in its own filename heading", () => {
    // "(11 sumber)" — if a twelfth source appears, this fails first.
    const heading = `(${EXPORT_SOURCES.length} sumber)`;
    expect(page.includes(heading), `microsite filename heading no longer says ${heading}`).toBe(true);
  });
});

// ── Permissions ────────────────────────────────────────────────────────────

describe("microsite — permissions", () => {
  const required = manifest.permissions ?? [];
  const optional = manifest.optional_permissions ?? [];
  const hosts = manifest.host_permissions ?? [];

  it("documents every permission the manifest requests", () => {
    for (const permission of [...required, ...optional]) {
      expect(
        permTable.includes(permission),
        `the microsite permission table does not list "${permission}"`,
      ).toBe(true);
    }
  });

  it("documents the portal host, and only the portal host", () => {
    expect(hosts.length).toBeGreaterThan(0);
    for (const pattern of hosts) {
      const host = new URL(pattern).host;
      expect(permTable.includes(host), `the permission table does not name ${host}`).toBe(true);
    }
  });

  it("has one permission-table row per requested permission", () => {
    const rows = (permTable.match(/<tr>/g) ?? []).length;
    const expected = required.length + optional.length + hosts.length;
    expect(rows, "the permission table must have a header row plus one row per permission").toBe(
      1 + expected,
    );
  });
});

// ── Shortcuts ──────────────────────────────────────────────────────────────

describe("microsite — keyboard shortcuts", () => {
  // `shortcuts.ts` registers its keys inline instead of exporting a table, so
  // the keys are read from its source. If that module is ever rewritten around
  // a constant, this parser finds nothing and says so instead of passing
  // silently.
  const shortcutKeys = [
    ...new Set([...shortcutsSource.matchAll(/e\.key === "([A-Za-z])"/g)].map((m) => m[1].toUpperCase())),
  ];

  it("finds the shortcut keys the content script registers", () => {
    expect(
      shortcutKeys.length,
      "no shortcut keys parsed from shortcuts.ts — update the parser in this suite",
    ).toBeGreaterThan(0);
  });

  it("documents every registered shortcut", () => {
    for (const key of shortcutKeys) {
      expect(
        page.includes(`Ctrl+Shift+${key}`),
        `microsite does not document the Ctrl+Shift+${key} shortcut`,
      ).toBe(true);
    }
  });

  it("documents the Shift modifier the handler requires", () => {
    expect(shortcutsSource).toMatch(/\.shiftKey/);
    expect(page.includes("Shift"), "microsite never mentions the Shift modifier").toBe(true);
  });
});

// ── Supported pages ────────────────────────────────────────────────────────

describe("microsite — supported portal pages", () => {
  it("documents every page the extension supports", () => {
    for (const { url, path } of SUPPORTED_PAGES) {
      expect(
        isSupportedExportPage(url),
        `page-context.ts no longer supports ${url} — drop it from this suite`,
      ).toBe(true);
      expect(page.includes(path), `microsite does not list the supported page ${path}`).toBe(true);
    }
  });

  it("lists no page the extension does not support", () => {
    // The other direction: every path the page advertises must still be a
    // supported export page, so a renamed URL or a typo fails here.
    const advertised = [...microsite.matchAll(/<span class="path">([^<]+)<\/span>/g)].map(
      (m) => m[1].trim(),
    );

    expect(advertised.length, "the role grid lost its page chips").toBeGreaterThan(0);

    for (const path of advertised) {
      const url = `${PORTAL}${path}`;
      expect(isSupportedExportPage(url), `microsite advertises unsupported page ${path}`).toBe(true);
      expect(describePortalPage(url)).not.toContain("belum didukung");
    }
  });
});

// ── Status labels: comparer + checker ─────────────────────────────────────

describe("microsite — status labels", () => {
  const comparerLegend = statusLegend("p5");
  const checkerLegend = statusLegend("p6");

  it("finds a status legend on both result tabs", () => {
    expect(comparerLegend, "the comparer tab (p5) lost its .status-legend").not.toBe("");
    expect(checkerLegend, "the checker tab (p6) lost its .status-legend").not.toBe("");
  });

  it("documents every status the comparer can produce", () => {
    // Labels come out of the real `getStatusLabel`, walked over the canonical
    // status list, so a seventh ComparisonStatus arrives here already spelled.
    for (const status of COMPARISON_STATUSES) {
      const label = getStatusLabel(status);
      expect(
        comparerLegend.includes(label),
        `the comparer status legend does not show the "${status}" status ("${label}")`,
      ).toBe(true);
    }
  });

  it("documents every status filter the checker offers", () => {
    const options = parseFilterOptions("checkerFilterOptions");
    expect(
      options.length,
      "no checker filter options parsed from ui-comparer.ts — update the parser in this suite",
    ).toBeGreaterThan(0);

    // "Semua Status" is the filter's own reset entry, not a result status.
    for (const { value, label } of options.filter((option) => option.value !== "ALL")) {
      expect(
        checkerLegend.includes(label),
        `the checker status legend does not show the ${value} filter ("${label}")`,
      ).toBe(true);
    }
  });

  it("shows no status on either tab that the code does not produce", () => {
    const known = new Set<string>([
      ...COMPARISON_STATUSES.map((status) => getStatusLabel(status)),
      ...parseFilterOptions("checkerFilterOptions").map((option) => option.label),
    ]);

    for (const [legend, tab] of [
      [comparerLegend, "comparer"],
      [checkerLegend, "checker"],
    ] as const) {
      for (const [, label] of legend.matchAll(
        /status-pill[^>]*><span class="sw"><\/span>([^<]+)/g,
      )) {
        expect(
          known.has(label.trim()),
          `the ${tab} legend shows "${label.trim()}", which no status in the code produces`,
        ).toBe(true);
      }
    }
  });
});

// ── Filenames ───────────────────────────────────────────────────────────

describe("microsite — export filenames", () => {
  // A representative period hint. Coretax sends the `period` filter as
  // `YYYY-MM` or `TD00N-YYYY-MM`; both fold to the same MMYYYY period here, and
  // the folding itself is covered by the exporter's own property tests.
  const HINT = "2026-07";
  const CUSTOM_PREFIX = "PTABC-";

  it("names every result-grid export, in both formats, where its own tab names it", () => {
    expect(resultExportExtensions.length, "no export extensions found in comparer-export.ts").toBe(2);
    expect(resultExportFilenames.size, "no result filenames parsed — update the parser in this suite").toBe(2);

    for (const [tabId, filenames] of resultExportFilenames) {
      const tab = panel(tabId);
      for (const filename of filenames) {
        expect(tab.includes(filename), `the microsite never mentions ${filename}`).toBe(true);
      }
    }
  });

  it("shows the generated XLSX names the way the exporter builds them", () => {
    const extension = downloadExtension("XLSX_MIME_TYPE");
    expect(extension, "no XLSX extension found in exporter.ts — update this suite").toBeDefined();

    // Compared as WHOLE chips: a substring test would keep passing while the
    // standalone `FPK-072026.xlsx` chip was wrong, because the prefixed sample
    // `PTABC-FPK-072026.xlsx` contains it.
    const chips = [...panel("p1").matchAll(/<span class="filechip">([^<]+)<\/span>/g)].map(
      (match) => match[1],
    );
    expect(chips.length, "the export tab lost its filename samples").toBeGreaterThan(0);

    for (const source of ["OUTPUT_TAX", "SPT_A2"] as const) {
      const name = `${generateDynamicFilename({ data: [], fields: [], source, filenameHint: HINT })}${extension}`;
      expect(chips.includes(name), `the filename samples do not include "${name}" (${source})`).toBe(
        true,
      );
    }
  });

  it("puts the custom popup prefix in front of the per-source prefix", () => {
    const name = `${generateDynamicFilename({
      data: [],
      fields: [],
      source: "OUTPUT_TAX",
      filenameHint: HINT,
      filenamePrefix: CUSTOM_PREFIX,
    })}${downloadExtension("XLSX_MIME_TYPE")}`;

    const chips = [...panel("p1").matchAll(/<span class="filechip">([^<]+)<\/span>/g)].map(
      (match) => match[1],
    );
    expect(chips.includes(name), `the filename samples do not include "${name}"`).toBe(true);
  });

  it("keeps the trailing dash of a custom prefix, as the popup hints", () => {
    expect(normalizeFilenamePrefix(CUSTOM_PREFIX)).toBe(CUSTOM_PREFIX);
  });

  it("shows a sample of every generated bulk-PDF name", () => {
    const generated = [
      generateOutputTaxFilename({ Reference: "SZ-0447/07/26", LetterNumber: "010.000-26.00000001" }),
      generateWithholdingFilename({
        WithholdingSlipsNumber: "BP-001",
        WithholdingSlipsDate: "2026-07-31T00:00:00+07:00",
        EmployerName: "PT MITRA",
      }),
    ];

    // A sample that fits is spelled out in full and must match EXACTLY. Only the
    // long e-Faktur sample is abbreviated with an ellipsis in the middle
    // ("…-26.…pdf"), and for that one the part before the ellipsis must start
    // the generated name and the part after it must end it — a changed
    // separator, field order, or filler word stops it matching.
    const shown = [...panel("p2").matchAll(/<td class="filechip"[^>]*>([^<]+)<\/td>/g)].map(
      (match) => match[1],
    );

    expect(shown.length, "the PDF tab lost its filechip samples").toBeGreaterThan(0);

    for (const name of generated) {
      const matches = shown.some((sample) => {
        if (!sample.includes("\u2026")) return sample === name;
        const [head = "", tail = ""] = sample.split("\u2026");
        return name.startsWith(head) && name.endsWith(tail);
      });
      expect(
        matches,
        `the microsite shows no sample of the generated PDF name "${name}" (samples: ${shown.join(" | ")})`,
      ).toBe(true);
    }
  });
});

// ── Feature tabs ───────────────────────────────────────────────────────

describe("microsite — feature tabs", () => {
  const micrositeJs = read("../../microsite/assets/js/microsite.js");
  const css = read("../../microsite/assets/css/microsite.css");

  const tabInputs = [...microsite.matchAll(/<input type="radio" name="tabs" id="(t\d+)"/g)].map((m) => m[1]);
  const tabPanels = [...microsite.matchAll(/<div class="tab-panel" id="(p\d+)">/g)].map((m) => m[1]);
  const tabLabels = [...microsite.matchAll(/<label for="(t\d+)">([^<]+)<\/label>/g)].map((m) => ({
    target: m[1],
    text: m[2].trim(),
  }));

  it("pairs every tab with exactly one panel and one label", () => {
    expect(tabInputs.length, "the feature tabs lost their radio inputs").toBeGreaterThan(1);
    expect(tabPanels.length).toBe(tabInputs.length);
    expect(tabLabels.length).toBe(tabInputs.length);

    // The stylesheet wires them as `#t3:checked ~ .tabs-ui #p3`, so the ids have
    // to line up by number or a tab silently shows the wrong panel.
    for (const id of tabInputs) {
      const panel = `p${id.slice(1)}`;
      expect(tabPanels, `tab ${id} has no #${panel} panel`).toContain(panel);
      expect(tabLabels.map((l) => l.target), `tab ${id} has no visible label`).toContain(id);
    }
  });

  it("keeps the radios reachable without JavaScript", () => {
    // display:none would drop them out of the tab order, taking the whole
    // keyboard story with it; they are hidden but focusable on purpose.
    const rule = css.match(/\.tabs input\{([^}]*)\}/)?.[1] ?? "";
    expect(rule, "the .tabs input rule is gone").not.toBe("");
    expect(rule).not.toMatch(/display\s*:\s*none/);
    expect(rule).toMatch(/opacity\s*:\s*0/);
  });

  it("scopes the scroll-reveal to .js so no-script readers still see the page", () => {
    // The pairing is the whole point: the inline script adds `.js`, and the
    // hidden state hangs off that class. Lose either half and every section
    // sticks at opacity:0 for anyone without JavaScript.
    expect(microsite).toContain('document.documentElement.classList.add("js")');
    expect(css, "the reveal styles must be scoped to .js").toMatch(/\.js \.reveal\{[^}]*opacity:0/);
    expect(css, "an unscoped .reveal would hide content when scripting is off").not.toMatch(
      /(^|[},])\s*\.reveal\{[^}]*opacity:0/,
    );
  });

  it("still upgrades the radio group into an ARIA tablist", () => {
    // A smoke check, not a behaviour test: these are the attributes a screen
    // reader needs, and deleting the upgrade block should fail here.
    expect(micrositeJs).toContain('role", "tablist"');
    for (const attr of ["aria-selected", "aria-controls", "aria-labelledby", "tabpanel"]) {
      expect(micrositeJs, `microsite.js no longer sets ${attr}`).toContain(attr);
    }
    // aria-hidden must never wrap something that can still take focus.
    expect(micrositeJs).toMatch(/aria-hidden.*\n\s*.*tabIndex = -1/);
  });
});

// ── Site URL and hosting ────────────────────────────────────────────────

describe("microsite — site URL", () => {
  /**
   * The hostname lives in four files that have no build step to keep them in
   * step: the canonical link, og:url, sitemap.xml, and robots.txt. Rename the
   * site and three of them silently keep advertising the old address. One
   * origin, asserted everywhere it is repeated.
   */
  const origin = microsite.match(/<link rel="canonical" href="([^"]+)"/)?.[1];

  it("declares an absolute https canonical", () => {
    expect(origin, "index.html lost its <link rel=\"canonical\">").toBeDefined();
    expect(origin, "the canonical URL must be absolute https").toMatch(/^https:\/\/[^/]+\/$/);
  });

  it("points og:url at the canonical", () => {
    const ogUrl = microsite.match(/<meta property="og:url" content="([^"]+)"/)?.[1];
    expect(ogUrl, "index.html lost its og:url").toBe(origin);
  });

  it("points the social card at an absolute URL on the same host", () => {
    const image = microsite.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    expect(image, "index.html lost its og:image").toBeDefined();
    expect(image, "og:image must be absolute — a crawler cannot resolve a relative one")
      .toMatch(/^https:\/\//);
    // og:image is the one asset URL that cannot stay relative, so it is checked
    // against the canonical's host rather than left to drift.
    expect(new URL(String(image)).origin).toBe(new URL(String(origin)).origin);
  });

  it("lists every canonical page in the sitemap, and nothing else", () => {
    // Both directions. A page that is canonical but unlisted is invisible to
    // search engines; a sitemap entry with no page behind it is a dead link
    // waiting to be indexed.
    const locations = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const pages = [microsite, privacyPolicy];

    for (const pageSource of pages) {
      const canonical = pageSource.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
      expect(canonical, "a microsite page lost its canonical link").toBeDefined();
      expect(locations, `${canonical} is not listed in sitemap.xml`).toContain(canonical);
    }

    for (const location of locations) {
      expect(
        pages.some((p) => p.includes(`rel="canonical" href="${location}"`)),
        `sitemap.xml lists ${location}, but no microsite page declares that canonical`,
      ).toBe(true);
    }
  });

  it("gives every microsite page the same origin", () => {
    for (const [name, text] of [
      ["index.html", microsite],
      ["privacy.html", privacyPolicy],
    ] as const) {
      expect(
        new URL(text.match(/<link rel="canonical" href="([^"]+)"/)![1]).origin,
        `${name} points its canonical at a different host than the others`,
      ).toBe(new URL(String(origin)).origin);
    }
  });

  it("points robots.txt at the same sitemap", () => {
    const declared = robotsTxt.match(/^Sitemap:\s*(\S+)/m)?.[1];
    expect(declared, "robots.txt lost its Sitemap: line").toBeDefined();
    expect(new URL(String(declared)).pathname).toBe("/sitemap.xml");
    expect(robotsTxt).toContain("https://");
  });

  it("leaves no host placeholder behind", () => {
    for (const [name, text] of [
      ["index.html", microsite],
      ["404.html", notFoundPage],
      ["privacy.html", privacyPolicy],
      ["robots.txt", robotsTxt],
      ["sitemap.xml", sitemapXml],
    ] as const) {
      expect(
        /__SITE|TODO|FIXME|example\.com/.test(text),
        `${name} still carries a placeholder host or TODO marker`,
      ).toBe(false);
    }
  });
});

describe("microsite — colour contrast", () => {
  const injectedCss = read("../../styles/injected.css");

  // ── WCAG 2.1 maths, in the test itself so the numbers are auditable ──────
  const parseColour = (value: string): { rgb: [number, number, number]; a: number } => {
    const s = value.trim();
    if (s.startsWith("#")) {
      const h = s.slice(1);
      const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
      return { rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number], a: 1 };
    }
    const parts = s.match(/rgba?\(([^)]+)\)/)![1].split(",").map(Number);
    return { rgb: parts.slice(0, 3) as [number, number, number], a: parts.length > 3 ? parts[3] : 1 };
  };
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = ({ rgb }: { rgb: readonly number[] }) =>
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  /** Composite translucent ink over an opaque surface, the way a browser does. */
  const flatten = (top: { rgb: readonly number[]; a: number }, bottom: { rgb: readonly number[] }) => ({
    rgb: [0, 1, 2].map((i) => top.rgb[i] * top.a + bottom.rgb[i] * (1 - top.a)) as [number, number, number],
    a: 1,
  });
  const contrast = (fg: { rgb: readonly number[] }, bg: { rgb: readonly number[] }) => {
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  };

  // Only colour-valued tokens: --maxw:1100px shares the syntax.
  const isColour = (v: string) => /^#[0-9a-f]{3,8}$/i.test(v.trim()) || /^rgba?\(/i.test(v.trim());
  const tokensOf = (css: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [, name, value] of css.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) {
      if (isColour(value)) out[name] = value.trim();
    }
    return out;
  };
  const TOKENS = tokensOf(micrositeCss);
  /** Resolve a paint: a token from :root, or a literal the sheet writes inline. */
  const colour = (name: string) => {
    if (isColour(name)) return parseColour(name);
    const raw = TOKENS[name];
    expect(raw, `microsite.css lost the ${name} token`).toBeDefined();
    return parseColour(String(raw));
  };

  const PAPER = colour("--paper");
  const PAPER_ALT = colour("--paper-alt");
  const CARD = colour("--card");
  const INK = colour("--ink");
  const WHITE = parseColour("#fff");

  /** Resolve a background reference, compositing any tint over its surface. */
  const background = (ref: string, tintOver = PAPER) => {
    const c = colour(ref);
    return c.a === 1 ? c : flatten(c, tintOver);
  };

  // Every rendered TEXT pair the audit covers. `tintOver` says what surface a
  // translucent background actually sits on — the status legend lives inside
  // .feat-side (--card), the roadmap tag and diagram live on --card, and the
  // rest sit on --paper. Large text is >=24px, or >=18.66px at weight >=700.
  const TEXT_PAIRS: readonly (readonly [string, string, string, number, number, typeof PAPER?])[] = [
    ["body text", "--ink", "--paper", 16, 400],
    ["body text on alt-bg", "--ink", "--paper-alt", 16, 400],
    ["body text on card", "--ink", "--card", 16, 400],
    [".hero .lede", "--ink-soft", "--paper", 18, 400],
    [".hero h1 em", "--stamp", "--paper", 64, 600],
    [".section-head .sub", "--ink-soft", "--paper", 16, 400],
    [".navlinks a", "--ink-soft", "--paper", 14, 400],
    [".navlinks a:hover", "--stamp-dark", "--paper", 14, 400],
    [".foot-links a", "--ink-soft", "--paper", 13.5, 400],
    [".foot-links a:hover", "--stamp-dark", "--paper", 13.5, 400],
    [".foot-note", "--ink-soft", "--paper", 13, 400],
    [".brand", "--ink", "--paper", 19, 700],
    [".btn-primary label", "--paper", "--ink", 14.5, 600],
    [".btn-ghost label", "--ink", "--paper", 14.5, 600],
    [".cd-btn label (toolbar mock)", "#fff", "--stamp", 13, 600],
    [".ct-btn label (portal mock)", "--ink-soft", "--paper-deep", 13, 500],
    [".ct-input text", "--miss-ink", "#fff", 13, 400],
    [".eyebrow", "--stamp-dark", "--paper", 12.5, 400],
    [".eyebrow on alt-bg", "--stamp-dark", "--paper-alt", 12.5, 400],
    [".hero-note", "--stamp-dark", "--paper", 12.5, 400],
    [".install-card .ic-tag", "--stamp-dark", "--card", 11, 400],
    [".perm-table td:first-child", "--stamp-dark", "--paper", 13, 400],
    [".opt-tag", "--stamp-dark", "--stamp-tint", 10, 500],
    [".legal .stamp-note", "--stamp-dark", "--stamp-tint", 11, 400],
    [".legal .none", "--match-ink", "--match-tint", 12.5, 400, PAPER],
    [".roadmap-card .tag", "--diff-ink", "--diff-tint", 11, 400, CARD],
    [".pill-match (card)", "--match-ink", "--match-tint", 13, 500, CARD],
    [".pill-diff (card)", "--diff-ink", "--diff-tint", 13, 500, CARD],
    [".pill-bad (card)", "--bad-ink", "--bad-tint", 13, 500, CARD],
    [".pill-miss (card)", "--miss-ink", "--miss-tint", 13, 500, CARD],
    [".pill-only (card)", "--only-ct-ink", "--only-ct-tint", 13, 500, CARD],
    [".pill-match (paper)", "--match-ink", "--match-tint", 13, 500, PAPER],
    [".pill-diff (paper)", "--diff-ink", "--diff-tint", 13, 500, PAPER],
    [".pill-bad (paper)", "--bad-ink", "--bad-tint", 13, 500, PAPER],
    [".pill-miss (paper)", "--miss-ink", "--miss-tint", 13, 500, PAPER],
    [".pill-only (paper)", "--only-ct-ink", "--only-ct-tint", 13, 500, PAPER],
    [".compare-table th", "--ink-soft", "--card", 11.5, 600],
    [".compare-table td.before", "--bad-ink", "--card", 14.5, 400],
    [".compare-table td.after", "--match-ink", "--card", 14.5, 500],
    [".pref-table td", "--ink-soft", "--card", 14, 400],
    [".pref-table td:first-child", "--ink", "--card", 15, 700],
    [".perm-table th", "--ink-soft", "--paper", 11, 600],
    [".perm-table td", "--ink", "--paper", 14, 400],
    [".mini-table th", "--ink-soft", "--card", 11, 600],
    [".tab-labels label", "--ink-soft", "--paper", 14, 600],
    [".tab-labels label:hover", "--ink", "--paper", 14, 600],
    [".tab-labels label[selected]", "--stamp-dark", "--paper", 14, 600],
    [".feat-steps li", "--ink", "--paper", 14.5, 400],
    [".feat-steps li::before number", "--stamp-dark", "--paper", 12, 600],
    [".feat-problem", "--ink-soft", "--paper", 15, 400],
    [".feat-side h3", "--ink-soft", "--card", 13, 400],
    // The skip link reuses .btn/.btn-primary, so it is the same --paper-on-
    // --ink pair the buttons already prove — but it is a distinct usage, and
    // this table exists to enumerate usages rather than tokens.
    [".skip-link", "--paper", "--ink", 14.5, 600],
    [".role-item .path", "--only-ct-ink", "--only-ct-tint", 12.5, 400, CARD],
    [".role-item .who", "--ink", "--card", 15, 600],
    [".sd-node .lbl", "--ink-soft", "--card", 11, 400],
    [".sd-ct .name", "--match-ink", "--match-tint", 14.5, 600, CARD],
    [".sd-other .badge", "--bad-ink", "--bad-tint", 12, 400, CARD],
    [".comply-card .cc-num", "--stamp", "--card", 12, 600],
    [".comply-card .cc-text", "--ink-soft", "--card", 13.5, 400],
    [".comply-link a", "--stamp-dark", "--paper", 13.5, 600],
    [".browser-badge .ok", "--match-ink", "--card", 12, 600],
    [".ic-lead", "--ink-soft", "--card", 13.5, 400],
    [".install-card ol", "--ink-soft", "--card", 13.5, 400],
    [".ic-note", "--ink-soft", "--card", 12.5, 400],
    [".code-block", "--paper", "--ink", 12.5, 400],
    [".dl-note", "--ink-soft", "--paper", 13, 400],
    [".faq-item summary", "--ink", "--paper", 15.5, 600],
    [".faq-item summary::after +", "--stamp-dark", "--paper", 20, 400],
    [".faq-a", "--ink-soft", "--paper", 14.5, 400],
    [".td-chrome", "--ink-soft", "--paper-deep", 12, 400],
    [".td-url", "--ink-soft", "--paper", 12, 400],
    [".td-toolbar-label", "--ink-soft", "--card", 11, 400],
    [".td-caption", "--ink-soft", "--card", 13, 400],
    [".td-caption b", "--stamp-dark", "--card", 13, 600],
    ["::selection", "#fff", "--stamp", 16, 400],
    // 404.html carries its own scoped <style> block, so these are separate
    // usages of the same tokens on the same surface. A token that passes on
    // the landing page can still fail here: `.nf .code` is --stamp at 14px,
    // where the 64px `.hero h1 em` is comfortably large text.
    ["404 .nf .code", "--stamp-dark", "--paper", 14, 400],
    ["404 .nf h1", "--ink", "--paper", 30, 700],
    ["404 .nf .lede", "--ink-soft", "--paper", 16, 400],
    ["404 .brand", "--ink", "--paper", 19, 700],
    ["404 .hero-cta .btn-primary", "--paper", "--ink", 14.5, 600],
    // Surfaced by the browser sweep: rendered text that no entry covered.
    [".hero h1", "--ink", "--paper", 64, 700],
    [".hero .lede strong", "--ink", "--paper", 18, 600],
    [".section-head p.sub", "--ink-soft", "--paper", 16, 400],
    [".pref-table th", "--ink-soft", "--card", 11.5, 600],
    [".sd-arrow", "--ink-soft", "--card", 11.5, 400],
    [".sd-arrow .line", "--ink-soft", "--card", 11.5, 400],
    [".comply-link", "--ink-soft", "--paper", 13.5, 400],
    [".kbd", "--paper", "--ink", 12.5, 600],
    [".ct-input .cd-ic", "--ink-soft", "#fff", 13, 400],
  ];

  it("keeps every rendered text pair at WCAG AA", () => {
    // 4.5:1 for normal text, 3:1 for large. Each entry names the surface a
    // translucent background actually sits on, because compositing the same
    // tint over --paper and over --card gives two different answers.
    const failures: string[] = [];
    for (const [label, fgRef, bgRef, px, weight, tintOver = PAPER] of TEXT_PAIRS) {
      const fgToken = colour(fgRef);
      const fg = fgToken.a === 1 ? fgToken : flatten(fgToken, tintOver);
      const ratio = contrast(fg, background(bgRef, tintOver));
      const need = px >= 24 || (px >= 18.66 && weight >= 700) ? 3 : 4.5;
      if (ratio < need) {
        failures.push(`${label}: ${fgRef} on ${bgRef} is ${ratio.toFixed(2)}:1, needs ${need}:1`);
      }
    }
    expect(failures.join("\n"), "these text pairs fall below WCAG AA").toBe("");
  });

  it("renders the code-block comments at AA too", () => {
    // The one text colour written as a literal rather than a token: a 55%
    // paper on the ink block. It is the easiest pair on the site to break by
    // nudging an alpha, and it is not covered by the token table above.
    const cmt = micrositeCss.match(/\.code-block \.cmt\{color:(rgba?\([^)]+\));?\}/);
    expect(cmt, ".code-block .cmt lost its colour declaration").not.toBeNull();
    expect(contrast(flatten(parseColour(cmt![1]), INK), INK)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps control borders at the 3:1 non-text threshold", () => {
    // WCAG 1.4.11: a boundary that identifies a control has to be visible.
    // --line-strong is a decorative hairline (1.75:1) and cannot do that job.
    const failures: string[] = [];
    const line = colour("--control-line");
    for (const [label, surface] of [
      [".btn-ghost border on paper", PAPER],
      [".btn-ghost border on alt-bg", PAPER_ALT],
      [".ct-input border on its own white fill", WHITE],
    ] as const) {
      const ratio = contrast(line.a === 1 ? line : flatten(line, surface), surface);
      if (ratio < 3) failures.push(`${label} is ${ratio.toFixed(2)}:1, needs 3:1`);
    }
    expect(failures.join("\n"), "a control border is too faint to see").toBe("");

    // And the two controls really do use it rather than the hairline token.
    for (const selector of [".btn-ghost{", ".ct-input{"]) {
      const rule = micrositeCss.slice(micrositeCss.indexOf(selector));
      const block = rule.slice(0, rule.indexOf("}"));
      expect(
        block,
        `${selector} must draw its border with --control-line, not --line-strong`,
      ).toContain("--control-line");
    }
  });

  it("keeps the status hues mirrored from the extension's own tokens", () => {
    // The microsite depicts the product's palette, so the base status tokens
    // are byte-identical copies of injected.css. That mirror is why the AA
    // fixes went into separate `-ink` tokens rather than into these — if a
    // future change moves one, it is either deliberate or a mistake, and this
    // is where that shows up.
    const extensionTokens = tokensOf(injectedCss);
    const MIRRORED: readonly (readonly [string, string])[] = [
      ["--match", "--ch-match"],
      ["--diff", "--ch-diff"],
      ["--bad", "--ch-bad"],
      ["--miss", "--ch-text-muted"],
      ["--only-ct", "--ch-blue"],
      ["--ink-soft", "--ch-text-dark"],
      ["--card", "--ch-white"],
      ["--paper", "--ch-paper"],
      ["--paper-alt", "--ch-paper-alt"],
      ["--stamp", "--ch-primary"],
    ];
    const drift: string[] = [];
    for (const [site, extension] of MIRRORED) {
      const a = (TOKENS[site] ?? "").toUpperCase().replace(/\s+/g, "");
      const b = (extensionTokens[extension] ?? "").toUpperCase().replace(/\s+/g, "");
      if (a !== b) drift.push(`${site} is ${a} but ${extension} is ${b}`);
    }
    expect(drift.join("\n"), "the microsite palette drifted from the extension's").toBe("");
  });

  it("audits the token each listed rule actually uses", () => {
    // The gap this closes: TEXT_PAIRS is hand-written, and a hand-written
    // table rots silently. `.nf .code` on 404.html sat at 4.42:1 -- a real AA
    // failure -- precisely because the page carries its own <style> block, so
    // its rules were on nobody's radar, and `--stamp` already looked covered
    // by the 64px `.hero h1 em`. Membership checks cannot catch that, and
    // neither can token-level checks: the same token passes at 64px and fails
    // at 14px. What catches it is asking the SOURCE, per rule, which token it
    // names, and requiring that to equal what the table claims to have tested.
    //
    // Scope, stated honestly: this verifies every entry whose label is a real
    // selector in the stylesheet (`.nf .code`, `.pill-diff`, `.ct-input`,
    // `.hero .lede`, `.feat-steps li::before`, ...). Descriptive labels are
    // skipped -- "body text on alt-bg" and "pill-diff (paper)" name a surface
    // or a reading of a rule rather than a selector, and about a quarter of
    // the table reads that way. A brand-new coloured rule is therefore not
    // caught here; adding one still means adding its entry to TEXT_PAIRS.
    const sources = [
      micrositeCss,
      ...microsite.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g),
      ...notFoundPage.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g),
    ]
      .map((s) => (typeof s === "string" ? s : s[1]))
      .join("\n");

    /** "404 .pill-diff (paper)" -> ".pill-diff"; ".faq-item summary::after +" -> "...::after" */
    const selectorOf = (label: string): string =>
      label
        .replace(/^404\s+/, "")
        .replace(/\s*\([^)]*\)\s*$/, "")
        .replace(/\s*[+>~]\s*$/, "")
        .trim();

    /** The selector must start a rule, not merely appear inside one. */
    const findRule = (selector: string): string | undefined => {
      for (let at = sources.indexOf(selector); at !== -1; at = sources.indexOf(selector, at + 1)) {
        const before = sources.slice(0, at);
        if (before.length === 0 || /[},;]|\n\s*$/.test(before)) return selector + at.toString();
      }
      return undefined;
    };

    const drift: string[] = [];
    for (const [label, fgRef] of TEXT_PAIRS) {
      const selector = selectorOf(label);
      const found = findRule(selector);
      // NOTE: an unresolved label is skipped, deliberately — roughly a quarter
      // of the table is a descriptive reading (".eyebrow on alt-bg",
      // ".btn-primary label", "::selection") rather than a literal selector,
      // and "starts with a dot" does not tell the two apart. The consequence is
      // that a label that USED to resolve stops being verified in silence, so
      // any rule whose selector this project renames must also be pinned
      // directly elsewhere; the heading subheads are pinned by the
      // "microsite — heading outline" block for exactly that reason.
      if (found === undefined) continue;
      const at = Number(found.slice(selector.length));
      const block = sources.slice(at + selector.length).match(/\{([^{}]*)\}/);
      if (!block) {
        drift.push(`${label}: "${selector}" no longer has a declaration block`);
        continue;
      }
      // `border-color:` must not match, so the declaration needs a real
      // leading boundary rather than a bare substring.
      const used = block[1].match(/(?:^|[;{\s])color\s*:\s*(var\(\s*(--[a-z-]+)\s*\)|#[0-9a-f]{3,8})/i);
      // No `color:` in the block means the text INHERITS, and the inherited
      // value is not something this block can be checked against; TEXT_PAIRS
      // still computes the pair the entry declares.
      if (!used) continue;
      const token = used[1].startsWith("#") ? used[1] : used[2];
      if (token !== fgRef) {
        drift.push(`${label}: table says ${fgRef}, but "${selector}" uses ${token}`);
      }
    }
    expect(drift.join("\n"), "TEXT_PAIRS has drifted from the stylesheet").toBe("");
  });

  it("keeps text colours on the `-ink` tokens, never on the base hue", () => {
    // The rule that makes the AA fix durable: a base status token owns fills,
    // borders and swatches; only its `-ink` twin may set `color:`. Without
    // this, one well-meaning `color: var(--diff)` reopens a 2.4:1 pair while
    // every token-level assertion above still passes.
    const BASE_STATUS = ["--match", "--diff", "--bad", "--miss", "--only-ct"] as const;
    const sources = [
      ["microsite.css", micrositeCss],
      ["privacy.html", privacyPolicy],
      ["404.html", notFoundPage],
    ] as const;

    const offenders: string[] = [];
    for (const [name, source] of sources) {
      for (const token of BASE_STATUS) {
        const ink = `${token}-ink`;
        expect(TOKENS[ink], `microsite.css lost the ${ink} token`).toBeDefined();
        // A `color:` that names the base token without naming its `-ink` twin.
        for (const [, declaration] of source.matchAll(/color:\s*var\((--[a-z-]+)\)/g)) {
          if (declaration === token) {
            offenders.push(`${name} sets color: var(${token}); text must use var(${ink})`);
          }
        }
      }
    }
    expect(offenders.join("\n"), "a status hue is being used as a text colour").toBe("");
  });
});

describe("microsite — hosting files", () => {
  it("links the pages to each other with relative paths that exist", () => {
    // The README promises the folder works from a subdirectory, which is only
    // true while every internal link is relative. A root-anchored "/privacy.html"
    // silently breaks that claim, and a relative link to a renamed page is just
    // as broken — so both directions are checked against the files on disk.
    const pages = [
      ["index.html", microsite],
      ["privacy.html", privacyPolicy],
    ] as const;

    for (const [name, text] of pages) {
      for (const [, href] of text.matchAll(/<a [^>]*href="([^"]+)"/g)) {
        if (/^(https?:|#|mailto:)/.test(href)) continue; // external or same-page
        expect(
          href.startsWith("/"),
          `${name} links to "${href}" with a root-anchored path; relative links keep the folder portable`,
        ).toBe(false);
        expect(
          href.includes(".."),
          `${name} climbs out of the folder with "${href}"; the site has one output directory`,
        ).toBe(false);
        expect(
          existsSync(fileURLToPath(new URL(`../../microsite/${href}`, import.meta.url))),
          `${name} links to "${href}", which does not exist in microsite/`,
        ).toBe(true);
      }
    }
  });  it("leaves no mojibake in the prose", () => {
    // Editing these pages through tooling has already produced a "Präferensi".
    // That is invisible to a build and glaring to a store reviewer, so the
    // check is mechanical: every non-ASCII character the site uses is listed
    // here by name, and anything else means an edit landed garbled.
    const ALLOWED = new Set([
      "\u2011", // non-breaking hyphen (the prefix table's dashes)
      "\u2013", // en dash
      "\u2014", // em dash
      "\u2018", // left single quote
      "\u2019", // right single quote
      "\u201c", // left double quote
      "\u201d", // right double quote
      "\u2026", // ellipsis
      "\u00b7", // middle dot
      "\u00d7", // multiplication sign ("x" in dimensions)
      "\u2190", // left arrow (the breadcrumb)
      "\u2192", // right arrow
      "\u2699", // gear
      "\ufe0f", // variation selector-16 (after the gear)
      "\u2715", // multiplication x (the close button)
    ]);

    for (const [name, text] of [
      ["index.html", microsite],
      ["privacy.html", privacyPolicy],
      ["404.html", notFoundPage],
    ] as const) {
      const offender = [...text].find((ch) => ch.codePointAt(0)! > 127 && !ALLOWED.has(ch));
      const codePoint = offender ? `U+${offender.codePointAt(0)!.toString(16).toUpperCase()}` : "";
      expect(
        offender,
        `${name} contains the stray non-ASCII character "${offender}" (${codePoint}) — an edit likely landed garbled`,
      ).toBeUndefined();
    }
  });

  it("resolves the 404 page's assets from the site root", () => {
    // Cloudflare serves 404.html for any missing path, so a relative asset URL
    // would resolve against the requested path (/foo/assets/...) and 404 itself.
    expect(
      notFoundPage.match(/<base href="\/">/),
      "404.html needs <base href=\"/\"> or its relative assets break on deep paths",
    ).not.toBeNull();
  });

  it("keeps 404.html out of the index", () => {
    expect(notFoundPage).toMatch(/<meta name="robots" content="noindex/);
  });

  it("states every browser permission the manifest actually requests", () => {
    // The privacy policy is what a store reviewer reads before installing, and
    // it claims "only four permissions". That claim is checked here against
    // manifest.json, so it cannot quietly go out of date — a fifth permission
    // would redden the build rather than the page.
    const declared = manifest.permissions ?? [];
    const optional = manifest.optional_permissions ?? [];
    const hosts = manifest.host_permissions ?? [];

    for (const permission of [...declared, ...optional]) {
      expect(
        privacyPolicy.includes(permission),
        `the privacy policy does not mention the "${permission}" permission`,
      ).toBe(true);
    }

    for (const pattern of hosts) {
      const host = new URL(pattern).host;
      expect(
        privacyPolicy.includes(host),
        `the privacy policy does not name the host it contacts (${host})`,
      ).toBe(true);
    }

    // And the reverse: the policy must not list a permission that is not in the
    // manifest, which is the direction a store reviewer would act on.
    const claimed = [...privacyPolicy.matchAll(/<td>([a-z][a-zA-Z]+)<\/td>\s*<td>(wajib|opsional)<\/td>/g)].map(
      (m) => m[1],
    );
    expect(claimed.length, "the privacy policy's permission table lost its rows").toBe(
      declared.length + optional.length,
    );
    for (const permission of claimed) {
      expect(
        [...declared, ...optional].includes(permission),
        `the privacy policy claims a "${permission}" permission the manifest does not request`,
      ).toBe(true);
    }
  });

  it("counts the privacy policy's rows the way its prose does", () => {
    // The section introducing the table states a count in words ("empat entri"),
    // and a previous draft of that sentence said "empat izin, dan ketiganya" —
    // two different numbers in one clause, which no structural test can see.
    // Indonesian ordinals for 1-10 are spelled out, so the words are mapped
    // rather than parsed; anything outside that range fails loudly here.
    const WORDS: Record<number, string> = {
      1: "satu",
      2: "dua",
      3: "tiga",
      4: "empat",
      5: "lima",
      6: "enam",
      7: "tujuh",
      8: "delapan",
      9: "sembilan",
      10: "sepuluh",
    };

    const rows = privacyPolicy.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] ?? "";
    const tableRows = [...rows.matchAll(/<tr>/g)].length;
    const hosts = (manifest.host_permissions ?? []).length;
    expect(tableRows, "the privacy policy's permission table lost its rows").toBe(
      (manifest.permissions ?? []).length + (manifest.optional_permissions ?? []).length + hosts,
    );

    // Every number word the page uses to describe the table must be that one.
    const intro = privacyPolicy.match(/Cuma ada ([a-z]+) entri/)?.[1];
    expect(
      intro,
      "the privacy policy no longer states how many rows its permission table has",
    ).toBeDefined();
    expect(
      WORDS[tableRows],
      `the privacy policy says "Cuma ada ${intro} entri" but its table has ${tableRows} rows`,
    ).toBe(intro);
  });

  it("caches the fonts immutably and never caches the HTML", () => {
    expect(
      pageHeaders,
      "_headers must give /assets/fonts an immutable cache — there is no build step to hash them",
    ).toMatch(/\/assets\/fonts\/\*[\s\S]*?immutable/);
    expect(pageHeaders, "_headers must stop the HTML from being cached stale").toMatch(
      /Cache-Control:\s*public, max-age=0, must-revalidate/,
    );
  });

  it("gives the CSS and JS a real cache rule instead of the catch-all", () => {
    // Both fell through to the `/*` rule above, so ~31 KB was revalidated on
    // every page view. They are NOT immutable like the fonts: there is no build
    // step to hash a filename, so a year's cache would serve a fixed stylesheet
    // to returning visitors for a year after it was corrected. must-revalidate
    // is the part that has to survive — it is what stops this becoming the next
    // stale-asset bug in the other direction.
    for (const dir of ["css", "js"]) {
      const block = pageHeaders.match(new RegExp(`/assets/${dir}/\\*\\s*\\n\\s*Cache-Control:([^\\n]*)`));
      expect(
        block?.[1],
        `_headers has no Cache-Control rule for /assets/${dir}/* — it falls through to the HTML rule and is revalidated on every visit`,
      ).toBeDefined();
      expect(
        block?.[1],
        `/assets/${dir}/* must revalidate: with no content hash, an immutable cache would pin a hand-edited file for a year`,
      ).toMatch(/must-revalidate/);
      expect(
        block?.[1],
        `/assets/${dir}/* must not be immutable — see the note on the fonts rule above`,
      ).not.toMatch(/immutable/);
    }
  });

  it("never leaves an element labelled by `title` alone", () => {
    // The toolbar mockup labelled its two icon-only buttons with `title` and
    // nothing else. `title` is not reliably announced and cannot be focused, so
    // a screen reader read a list of injected buttons in which two items had
    // silently gone missing. The mockup is now one labelled `role="img"`, so a
    // `title` anywhere is a label with no announcement and no keyboard route
    // to it — unless it rides on an element that is hidden or has its own
    // accessible name.
    const unlabelled = [
      ...stripComments(microsite).matchAll(/<([a-z]+)([^>]*\btitle="([^"]*)"[^>]*)>/g),
    ]
      .filter(([, , attrs]) => !/aria-label=/.test(attrs) && !/aria-hidden="true"/.test(attrs))
      .map(([, tag, , title]) => `<${tag} title="${title}">`);

    expect(
      unlabelled.join("; "),
      "these elements use `title` as their only label — it is not reliably announced and not keyboard reachable",
    ).toBe("");
  });
});

// ── Popup preferences ───────────────────────────────────────────────────

describe("microsite — popup preferences", () => {
  const controlLabels = [...popupHtml.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m) => m[1].trim());
  const buttonLabels = [...popupHtml.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) =>
    m[1].trim(),
  );
  const sectionLabels = [...popupHtml.matchAll(/<summary>([^<]+)<\/summary>/g)].map((m) => m[1].trim());

  it("documents every control and every section the popup renders", () => {
    const labels = [...controlLabels, ...buttonLabels, ...sectionLabels];
    expect(labels.length, "the popup markup lost its labels — update this suite").toBeGreaterThan(0);

    for (const label of labels) {
      expect(prefTable.includes(label), `the preference table does not document "${label}"`).toBe(
        true,
      );
    }
  });

  it("documents no control the popup does not have", () => {
    const cells = [...rawPrefTable.matchAll(/<tr><td>([^<]+)<\/td>/g)].map((m) => flat(m[1]));
    expect(cells.length, "the preference table has no rows left").toBeGreaterThan(0);

    for (const cell of cells) {
      // Rows may read "Section · Control" so the reader knows where to look;
      // only the control name after the separator has to exist in the popup.
      const control = cell.includes("\u00b7") ? (cell.split("\u00b7").pop() ?? cell).trim() : cell;
      expect(
        popupHtml.includes(control),
        `the preference table documents "${cell}", which popup.html does not render`,
      ).toBe(true);
    }
  });

  it("states the bulk-confirmation threshold the code ships with", () => {
    expect(
      prefTable.includes(`lebih dari ${DEFAULT_BULK_CONFIRM_THRESHOLD}`),
      `the preference table does not state the default confirmation threshold (${DEFAULT_BULK_CONFIRM_THRESHOLD})`,
    ).toBe(true);
    expect(
      prefTable.includes(`<code>${NEVER_CONFIRM_THRESHOLD}</code>`),
      `the preference table does not say ${NEVER_CONFIRM_THRESHOLD} disables the confirmation`,
    ).toBe(true);
  });

  it("keeps the pacing presets and their multipliers honest in both places", () => {
    const options = [...popupHtml.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map((m) => ({
      value: m[1],
      label: flat(m[2]),
    }));
    expect(options.length, "the popup lost its pacing options — update this suite").toBeGreaterThan(0);

    for (const { value, label } of options) {
      const multiplier = DELAY_PRESET_MULTIPLIER[value as keyof typeof DELAY_PRESET_MULTIPLIER];
      expect(multiplier, `the popup offers a "${value}" preset the preference schema does not define`)
        .toBeDefined();

      // The popup states the multiplier in the option label ("Hati-hati (2× …)").
      if (multiplier > 1) {
        expect(
          label.includes(`${multiplier}\u00d7`),
          `the popup's "${label}" option does not state the ${multiplier}× multiplier from the schema`,
        ).toBe(true);
      }

      const name = label.replace(/\s*\(.*\)$/, "");
      expect(prefTable.includes(`<em>${name}</em>`), `the preference table does not offer "${name}"`)
        .toBe(true);
      if (multiplier > 1) {
        expect(
          prefTable.includes(`${multiplier}\u00d7 lebih lambat`),
          `the preference table does not state that "${name}" is ${multiplier}× slower`,
        ).toBe(true);
      }
    }
  });
});

// ── Legal copy ───────────────────────────────────────────────────────────

describe("microsite — legal copy matches the published audit", () => {
  // Every other block here guards code → page drift. This one guards the
  // opposite direction: LEGAL_COMPLIANCE.md reaches a written conclusion per
  // UU ITE article, and the page used to answer the legality FAQ with "belum
  // bisa dijawab pasti di sini" while calling itself a preview — for a review
  // the repository had already finished. A reader deciding whether to install
  // an extension on a government portal was told "unknown" where the repo says
  // "reviewed, clean". Nothing failed on that, because nothing compared the
  // page against the document it cites.
  //
  // The articles are parsed out of the audit rather than hand-listed here, so a
  // NEW article in the review fails the build until the page names it too. A
  // parser that finds nothing fails loudly for the same reason.

  /** Conclusions are written `* **Kesimpulan**: <first sentence>.` */
  const conclusions = [
    ...legalCompliance.matchAll(/\*\s*\*\*Kesimpulan\*\*:\s*(Cindieh[^*]*?)\.(?:\s|$)/g),
  ].map((m) => m[1].trim());

  const articles = conclusions
    .map((c) => c.match(/Pasal (\d+) UU ITE/)?.[1])
    .filter((a): a is string => a !== undefined);

  /** The FAQ answer, located by its own question rather than by page position. */
  const faqAnswer =
    microsite.match(
      /<summary>Apakah legal menggunakan[\s\S]*?<\/summary>\s*<p class="faq-a">([\s\S]*?)<\/p>/,
    )?.[1] ?? "";

  it("finds the audit conclusions the page depends on", () => {
    expect(
      conclusions.length,
      "LEGAL_COMPLIANCE.md lost its **Kesimpulan** lines — this suite can no longer tell what the page is quoting",
    ).toBeGreaterThan(0);
    expect(
      articles.length,
      "no conclusion in LEGAL_COMPLIANCE.md names a Pasal anymore, so the FAQ cannot be checked against them",
    ).toBeGreaterThan(0);
    expect(
      articles.length,
      "two conclusions named the same article — the page names one article once",
    ).toBe(new Set(articles).size);
  });

  it("keeps the page's clean bill of health honest", () => {
    // The FAQ states the review found no violation. That is only a fair summary
    // while every conclusion says so: a future audit that DOES find one must
    // red this test, because the copy claiming otherwise would then be false.
    const contrary = conclusions.filter((c) => !c.includes("tidak melanggar"));
    expect(
      contrary,
      `LEGAL_COMPLIANCE.md no longer finds Cindieh compliant (${contrary.join(" | ")}) — the FAQ and footer must be rewritten`,
    ).toEqual([]);
  });

  it("answers the legality FAQ instead of deferring the review", () => {
    expect(
      faqAnswer,
      "the legality FAQ no longer has an answer — its question or its <p class=\"faq-a\"> moved",
    ).not.toBe("");

    for (const article of articles) {
      expect(
        flat(faqAnswer).includes(`Pasal ${article} UU ITE`),
        `LEGAL_COMPLIANCE.md concludes on Pasal ${article} UU ITE but the legality FAQ never names it — a reader cannot check the claim`,
      ).toBe(true);
    }
  });

  it("carries no 'the review is still running' wording anywhere", () => {
    // Each phrase is wording this page actually used while the audit was
    // already finished. Matching them here is what makes the correction
    // durable: re-adding "we cannot answer that yet" is a one-word edit, and
    // without this check it would silently undo the fix.
    const PENDING = [
      "belum bisa dijawab",
      "belum bisa dipastikan",
      "halaman ini masih pratinjau",
      "akan diperbarui setelah tinjauan",
      "memerlukan tinjauan hukum",
    ];

    for (const phrase of PENDING) {
      // Compared as a boolean on purpose: `expect(page).not.toContain(...)`
      // prints all 44 KB of the page into the failure output, which buries the
      // one sentence that actually regressed.
      expect(
        page.includes(phrase),
        `the page still says "${phrase}" — LEGAL_COMPLIANCE.md has published its conclusions, so this is stale`,
      ).toBe(false);
    }
  });

  it("points readers at the audit it summarises", () => {
    const footer = microsite.match(/<footer>[\s\S]*?<\/footer>/)?.[0] ?? "";
    expect(
      footer,
      "index.html has no <footer> — the disclaimer this check reads is missing",
    ).not.toBe("");

    // Both the FAQ and the footer must cite the document, so the page's summary
    // is never the only account of what the review found.
    for (const [name, block] of [
      ["the legality FAQ", faqAnswer],
      ["the footer", footer],
    ] as const) {
      expect(
        block.includes("LEGAL_COMPLIANCE.md"),
        `${name} summarises the audit without linking LEGAL_COMPLIANCE.md`,
      ).toBe(true);
    }
  });
});

// ── Heading structure ────────────────────────────────────────────────────

describe("microsite — heading outline never skips a level", () => {
  // The page shipped thirteen <h4>s sitting directly under <h2> section
  // headings, with no <h3> anywhere between them, so every screen reader
  // announced an outline that jumped a level. Promoting them was a one-line
  // revert away from regressing, and nothing noticed: the contrast table pins
  // the COLOUR of `.feat-side h3`, which a demotion back to h4 would leave
  // untouched. This is the check that notices the level itself moving.
  //
  // Levels are read in DOCUMENT ORDER rather than per container, because a skip
  // is a property of the sequence (h1 -> h2 -> h4): validating each section in
  // isolation would pass a page that skips inside every one of them.

  const outlineOf = (html: string): { level: number; text: string }[] =>
    [...stripComments(html).matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({
      level: Number(m[1]),
      text: flat(m[2].replace(/<[^>]*>/g, "")).trim(),
    }));

  it("keeps a real rule for the promoted subheads", () => {
    // Promoting the subheads renamed `.feat-side h4` to `.feat-side h3`, and the
    // contrast table only verifies a label that STILL resolves to a rule — an
    // unresolved label is skipped, so renaming the stylesheet rule alone left
    // the suite fully green with thirteen subheads rendering at the browser's
    // default size and spacing. Both halves are pinned here instead.
    for (const selector of [".feat-side h3", ".install-card h3"]) {
      expect(
        micrositeCss.includes(`${selector}{`),
        `${selector} has no rule in microsite.css — the promoted subheads would render unstyled`,
      ).toBe(true);
    }
    expect(
      micrositeCss.includes(".feat-side h4{"),
      "microsite.css still styles .feat-side h4, but the page has no h4 left to style",
    ).toBe(false);
  });

  for (const [name, html] of [
    ["index.html", microsite],
    ["privacy.html", privacyPolicy],
    ["404.html", notFoundPage],
  ] as const) {
    it(`${name} has exactly one h1 and steps down by at most one level`, () => {
      const outline = outlineOf(html);
      expect(
        outline.length,
        `${name} lost its headings — an empty outline must not pass as correct`,
      ).toBeGreaterThan(0);

      const h1s = outline.filter((h) => h.level === 1);
      expect(h1s.length, `${name} must have exactly one h1, found ${h1s.length}`).toBe(1);
      expect(outline[0].level, `${name} opens at h${outline[0].level}, not h1`).toBe(1);

      const skips: string[] = [];
      for (let i = 1; i < outline.length; i++) {
        if (outline[i].level - outline[i - 1].level > 1) {
          skips.push(
            `h${outline[i - 1].level} "${outline[i - 1].text}" → h${outline[i].level} "${outline[i].text}"`,
          );
        }
      }
      expect(
        skips.join("; "),
        `${name} skips a heading level, which is exactly what breaks the outline a screen reader navigates by`,
      ).toBe("");

      // The jump check above only sees INCREASES, so on its own it is blind to
      // the likelier regression: demoting ONE subhead among its siblings turns
      // h3, h3, h4, h3 into a sequence with no jump in it at all. Proved by
      // counterfactual — that edit passed the jump check and is caught only
      // here. Within a section, every heading after the first is a sibling
      // subhead of it, so they have to agree.
      //
      // `keamanan` holds a second h2 (the pacing block is its own section-like
      // block nested in the section), which is a legal document-order step DOWN
      // and must not be read as a skip — hence "after the first", not "exactly
      // one h2".
      const sections = [
        ...html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g),
      ].map((m) => outlineOf(m[1]));

      for (const section of sections) {
        const siblings = section.slice(1);
        if (siblings.length < 2) continue; // nothing to disagree with
        const levels = [...new Set(siblings.map((h) => h.level))];
        expect(
          levels.length,
          `${name} has sibling subheads at mixed levels (${levels.join(", ")}) — demoting one ` +
            `orphans it from its siblings and from the .feat-side/.install-card rules`,
        ).toBe(1);
      }
    });
  }
});

// ── Structured data ──────────────────────────────────────────────────────

describe("microsite — JSON-LD matches what the page actually shows", () => {
  // Nothing here validated the ld+json block before this: it could have become
  // invalid JSON, or kept claiming a version the extension stopped shipping,
  // and no step of the build would have said so. FAQPage raises the stakes —
  // Google requires each answer to be VISIBLE on the page, so a copy that
  // drifts from the <details> below is structured data for text nobody can see.

  /** Visible text: tags stripped, the page's entities decoded, whitespace folded. */
  const plain = (html: string): string =>
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&mdash;|&#8212;/g, "\u2014")
      .replace(/&ndash;|&#8211;/g, "\u2013")
      .replace(/&hellip;/g, "\u2026")
      .replace(/&times;/g, "\u00d7")
      .replace(/&rarr;/g, "\u2192")
      .replace(/&larr;/g, "\u2190")
      .replace(/&middot;/g, "\u00b7")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "\u2019")
      .replace(/\s+/g, " ")
      .trim();

  const ldSource = microsite.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  )?.[1];

  const parsed = (): { "@graph": { "@type": string }[] } => JSON.parse(ldSource ?? "");

  /** The questions a reader can actually open, straight from the markup. */
  const visibleFaq = [
    ...microsite.matchAll(
      /<details class="faq-item"[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<p class="faq-a">([\s\S]*?)<\/p>/g,
    ),
  ].map((m) => ({ question: plain(m[1]), answer: plain(m[2]) }));

  it("parses as JSON and declares both nodes", () => {
    expect(ldSource, "index.html has no application/ld+json block").toBeDefined();
    let graph: { "@type": string }[];
    try {
      graph = parsed()["@graph"];
    } catch (error) {
      throw new Error(`the ld+json block is not valid JSON: ${(error as Error).message}`);
    }
    expect(graph.map((n) => n["@type"]), "the @graph lost a node").toEqual([
      "SoftwareApplication",
      "FAQPage",
    ]);
  });

  it("declares the version the extension actually ships", () => {
    const app = parsed()["@graph"].find((n) => n["@type"] === "SoftwareApplication") as
      | { softwareVersion?: string }
      | undefined;
    expect(app?.softwareVersion, "SoftwareApplication lost softwareVersion").toBe(
      (manifest as ManifestShape & { version?: string }).version,
    );
  });

  it("describes exactly the FAQ the page shows", () => {
    expect(
      visibleFaq.length,
      "no <details>/<summary> pairs matched — this suite can no longer see the visible FAQ",
    ).toBeGreaterThan(0);

    const page = parsed()["@graph"].find((n) => n["@type"] === "FAQPage") as
      | { mainEntity?: { name: string; acceptedAnswer: { text: string } }[] }
      | undefined;
    const entries = page?.mainEntity ?? [];

    expect(
      entries.length,
      `the FAQPage lists ${entries.length} questions but the page shows ${visibleFaq.length}`,
    ).toBe(visibleFaq.length);

    for (const { question, answer } of visibleFaq) {
      const entry = entries.find((e) => plain(e.name) === question);
      expect(
        entry,
        `the FAQPage is missing the question "${question}", which the page asks`,
      ).toBeDefined();
      // Compare the JSON-LD's answer against the visible one, NOT the visible
      // answer against the page: `visibleFaq` is extracted from the page, so the
      // latter is the page asserting it contains itself. That version passed a
      // counterfactual in which the structured answer was edited into text the
      // page never shows — which is precisely the thing Google penalises.
      expect(
        plain(entry!.acceptedAnswer.text),
        `the FAQPage answer for "${question}" is not the text the page shows — structured data must describe visible content`,
      ).toBe(answer);
    }
  });
});

// ── Landmarks and the skip link ──────────────────────────────────────────

describe("microsite — one main landmark and a skip link that skips", () => {
  // The landing page had nine <section>s and nothing wrapping them: no main
  // landmark for a screen reader to jump to, and a keyboard user had to tab
  // through the topbar's eight links before reaching any content. privacy.html
  // already had a <main>; index.html and 404.html did not.

  const FOCUSABLE = /<a\s[^>]*href=|<button\b|<input\b|<select\b|<textarea\b/gi;

  for (const [name, html] of [
    ["index.html", microsite],
    ["privacy.html", privacyPolicy],
    ["404.html", notFoundPage],
  ] as const) {
    const stripped = stripComments(html);
    const body = stripped.slice(stripped.indexOf("<body>") + 6, stripped.indexOf("</body>"));
    const skip = body.match(/<a\b[^>]*class="[^"]*\bskip-link\b[^"]*"[^>]*>/)?.[0];

    it(`${name} exposes exactly one main landmark`, () => {
      expect(
        [...stripComments(html).matchAll(/<main\b/g)].length,
        `${name} must expose exactly one <main>; zero means no landmark, two means the page is ambiguous`,
      ).toBe(1);
    });

    it(`${name} puts its skip link ahead of everything focusable`, () => {
      if (skip === undefined) {
        // A skip link is only worth having when there is something to skip, so
        // its absence is a failure only when focusable content precedes <main>.
        // privacy.html legitimately qualifies: <main> is its first element, so
        // a skip link there would jump nowhere.
        const before = body.slice(0, body.search(/<main\b/));
        expect(
          [...before.matchAll(FOCUSABLE)].length,
          `${name} has focusable content before <main> but no skip link — a keyboard user has to tab through all of it first`,
        ).toBe(0);
        return;
      }

      // The defining property: a skip link sitting behind eight links in the
      // tab order is not a skip link.
      expect(
        [...body.slice(0, body.indexOf(skip)).matchAll(FOCUSABLE)].length,
        `${name} places focusable content BEFORE its skip link, which defeats the point of it`,
      ).toBe(0);

      const target = skip.match(/href="#([^"]+)"/)?.[1];
      expect(target, `${name} skip link has no in-page target`).toBeDefined();
      expect(
        html.includes(`id="${target!}"`),
        `${name} skip link points at #${target}, which exists in no element — it would reload the page instead`,
      ).toBe(true);
    });
  }
});