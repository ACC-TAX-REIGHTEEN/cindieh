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
import { readFileSync } from "node:fs";
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
const manifest: ManifestShape = JSON.parse(read("../../manifest.json"));
const shortcutsSource = read("../content/shortcuts.ts");
// Hosting support files. Cloudflare Pages serves 404.html for any missing path,
// `_headers` sets the cache rules, and robots/sitemap carry the hostname.
const notFoundPage = read("../../microsite/404.html");
const pageHeaders = read("../../microsite/_headers");
const robotsTxt = read("../../microsite/robots.txt");
const sitemapXml = read("../../microsite/sitemap.xml");
const uiComparerSource = read("../content/ui-comparer.ts");
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

/** The XLSX names the two result grids are written under, from their call sites. */
const resultExportFilenames = [
  ...uiComparerSource.matchAll(/downloadXLSXFile\(\s*\w+,\s*"([^"]+\.xlsx)"/g),
].map((m) => m[1]);

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

  it("names the result-grid exports where their own tab names them", () => {
    expect(
      resultExportFilenames.length,
      "no result filenames parsed from ui-comparer.ts — update the parser in this suite",
    ).toBeGreaterThan(0);

    for (const [filename, tab] of [
      [resultExportFilenames[0], panel("p5")],
      [resultExportFilenames[1], panel("p6")],
    ] as const) {
      expect(tab.includes(filename), `the microsite never mentions ${filename}`).toBe(true);
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

  it("lists the canonical in the sitemap, and nothing else", () => {
    const locations = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locations.length, "the sitemap should list the single indexable page").toBe(1);
    expect(locations[0]).toBe(origin);
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

describe("microsite — hosting files", () => {
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

  it("caches the fonts immutably and never caches the HTML", () => {
    expect(
      pageHeaders,
      "_headers must give /assets/fonts an immutable cache — there is no build step to hash them",
    ).toMatch(/\/assets\/fonts\/\*[\s\S]*?immutable/);
    expect(pageHeaders, "_headers must stop the HTML from being cached stale").toMatch(
      /Cache-Control:\s*public, max-age=0, must-revalidate/,
    );
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