// ============================================================
// THE IMPORT GRAPH'S SHAPE — the two-worlds seam, checked
// ============================================================
// A cycle in the import graph is invisible to the type checker and to every
// suite that imports the modules in one direction: the module that closes the
// loop sees a partially-initialised binding, and the symptom is an undefined
// value in a code path nobody exercised. The leak this guards against is
// real — the MAIN world had two of them (period-sweep.ts importing its own
// parent for a context type, scraper-xhr.ts importing the parent's
// abortError), and both were invisible until the graph was drawn.
//
// This suite reads src/content/*.ts from disk and asserts the graph's shape:
//
//   1. no cycle at all among RUNTIME imports — a value cycle breaks module
//      initialisation,
//   2. the MAIN world's closure (everything scraper.ts reaches) is a DAG even
//      counting type-only edges, and
//   3. nothing in the MAIN world touches a browser API: the MAIN world runs
//      in the page and has no browser.* (the two-worlds seam).
//
// The graph is read from the SOURCE rather than from a module-graph tool, so
// the check lives in the same suite as everything else and needs no new
// dependency.
// ============================================================

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CONTENT_DIR = fileURLToPath(new URL("../content/", import.meta.url));

/** Every module in the content world, in a stable order. */
const moduleFiles: string[] = readdirSync(CONTENT_DIR)
  .filter((name) => name.endsWith(".ts"))
  .sort();

// ── Reading the source ───────────────────────────────────

/**
 * Remove comments and blank out string bodies, so a module name mentioned in
 * prose (or inside a URL) cannot be read as an import.
 *
 * The string bodies are kept in a list and replaced by placeholders, because
 * the import SPECIFIER is itself a string and has to be read back.
 */
interface Masked {
  code: string;
  strings: string[];
}

/** The placeholder a masked string body leaves behind. */
const PLACEHOLDER = /__CHSTR_(\d+)__/;

function mask(source: string): Masked {
  const strings: string[] = [];
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      let body = "";
      while (i < source.length) {
        if (source[i] === "\\") {
          body += source[i] + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        body += source[i];
        i++;
      }
      strings.push(body);
      out += `__CHSTR_${strings.length - 1}__`;
      continue;
    }
    out += ch;
    i++;
  }
  return { code: out, strings };
}

/** Read one module, masked. */
function readMasked(file: string): Masked {
  return mask(readFileSync(path.join(CONTENT_DIR, file), "utf8"));
}

// ── Reading the imports ──────────────────────────────────

interface Edge {
  /** The imported module's file name. */
  to: string;
  /** True when the import carries no runtime value (import type / export type). */
  typeOnly: boolean;
}

/** The text of one import statement, up to its `;` at brace depth zero. */
function statementBody(code: string, from: number): string {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === ";" && depth <= 0) return code.slice(from, i);
  }
  return code.slice(from);
}

/** True when a clause carries no runtime value. */
function clauseIsTypeOnly(clause: string): boolean {
  const trimmed = clause.trim();
  // `import type {…}` / `export type {…}`
  if (/^type\s/.test(trimmed)) return true;
  // `import { type A, type B }` — every specifier marked
  const braced = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!braced) return false;
  const parts = braced[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^type\s/.test(part));
}

/** Resolve a specifier to a module inside src/content, or null. */
function resolveTarget(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const resolved = path.resolve(CONTENT_DIR, path.dirname(fromFile), specifier);
  const relative = path.relative(CONTENT_DIR, resolved);
  if (relative.startsWith("..")) return null;
  const file = resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
  return existsSync(file) ? path.basename(file) : null;
}

/** Every import of one module, as edges. */
function edgesOf(file: string): Edge[] {
  const { code, strings } = readMasked(file);
  const edges: Edge[] = [];
  const seen = new Set<string>();

  const add = (specifier: string, typeOnly: boolean): void => {
    const target = resolveTarget(file, specifier);
    if (!target || target === file) return;
    const key = `${target}|${typeOnly ? "type" : "value"}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ to: target, typeOnly });
  };

  const keyword = /^[ \t]*(import|export)\b/gm;
  let match: RegExpExecArray | null;
  while ((match = keyword.exec(code)) !== null) {
    const body = statementBody(code, match.index + match[0].length);
    if (body.startsWith(".")) continue; // `import.meta`
    const from = body.search(/\bfrom\b/);
    if (from === -1) {
      // A side-effect import (`import "./x"`) or a dynamic one
      // (`import("./x")`) — both are runtime edges.
      const specifier = body.match(PLACEHOLDER);
      if (specifier) add(strings[Number(specifier[1])], false);
      continue;
    }
    const specifier = body.slice(from + 4).match(PLACEHOLDER);
    if (!specifier) continue;
    add(strings[Number(specifier[1])], clauseIsTypeOnly(body.slice(0, from)));
  }
  return edges;
}

/** The whole content world, as a map of module → its imports. */
const graph = new Map<string, Edge[]>(
  moduleFiles.map((file) => [file, edgesOf(file)]),
);

/** The edges a module has, filtered by kind. */
function edgesFrom(
  file: string,
  kind: "all" | "runtime",
  within?: Set<string>,
): Edge[] {
  const edges = graph.get(file) ?? [];
  return edges.filter((edge) => {
    if (kind === "runtime" && edge.typeOnly) return false;
    if (within && !within.has(edge.to)) return false;
    return true;
  });
}

/** Every module reachable from a starting point. */
function closure(start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const file = queue.shift()!;
    for (const edge of edgesFrom(file, "all")) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return seen;
}

/**
 * Find a cycle in a directed graph, as the path that closes it.
 *
 * Depth-first with three states: unvisited, on the stack, done. The path is
 * returned so a failure names the modules involved instead of just "cycle".
 */
function findCycle(adjacency: (file: string) => string[]): string[] | null {
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];

  const visit = (file: string): string[] | null => {
    state.set(file, "open");
    stack.push(file);
    for (const next of adjacency(file)) {
      const seen = state.get(next);
      if (seen === "open") {
        const at = stack.indexOf(next);
        return [...stack.slice(at), next];
      }
      if (seen !== "done") {
        const cycle = visit(next);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(file, "done");
    return null;
  };

  for (const file of graph.keys()) {
    if (state.get(file) === undefined) {
      const cycle = visit(file);
      if (cycle) return cycle;
    }
  }
  return null;
}

// ── The MAIN world ────────────────────────────────────────

/** The MAIN world is what scraper.ts reaches: the page's own script. */
const MAIN_ENTRY = "scraper.ts";
const mainWorld = closure(MAIN_ENTRY);

// ============================================================
// The suite
// ============================================================

describe("the content world's import graph", () => {
  it("has no cycle among its runtime imports", () => {
    const cycle = findCycle((file) =>
      edgesFrom(file, "runtime").map((edge) => edge.to),
    );
    expect(cycle, `runtime import cycle: ${cycle?.join(" -> ")}`).toBeNull();
  });

  it("keeps the MAIN world a DAG, type-only edges included", () => {
    // The MAIN world is where a cycle does the most damage: the page's script
    // is loaded once and its module order decides what a binding holds.
    const cycle = findCycle((file) =>
      mainWorld.has(file)
        ? edgesFrom(file, "all", mainWorld).map((edge) => edge.to)
        : [],
    );
    expect(cycle, `MAIN-world import cycle: ${cycle?.join(" -> ")}`).toBeNull();
  });

  it("keeps the browser API out of the MAIN world", () => {
    // The MAIN world has no browser.* — it is a page script. An import that
    // pulled a storage bridge in would be a broken seam, not a slow one.
    const offenders: string[] = [];
    for (const file of mainWorld) {
      const { code } = readMasked(file);
      if (
        /\b(browser|chrome)\s*\.\s*(runtime|storage|downloads|tabs|notifications|scripting|alarms|windows|cookies|identity|webRequest)\b/.test(
          code,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      `browser API in the MAIN world: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("gives the modules below the seam their context from BELOW, not from their parent", () => {
    // period-sweep.ts, scraper-intercept.ts and scraper-xhr.ts sit UNDER
    // scraper-actions.ts. When they reached back up for the context type or
    // abortError, the graph closed a loop. The seam (scraper-context.ts) is
    // below all of them, so the edge points one way.
    for (const file of ["period-sweep.ts", "scraper-intercept.ts", "scraper-xhr.ts"]) {
      const targets = (graph.get(file) ?? []).map((edge) => edge.to);
      expect(targets, `${file} must not import its parent`).not.toContain(
        "scraper-actions.ts",
      );
      expect(targets, `${file} must take the seam from scraper-context.ts`).toContain(
        "scraper-context.ts",
      );
    }
  });

  it("keeps the MAIN world's modules inside the MAIN world", () => {
    // A module of the isolated world (the panel, the run, the storage
    // bridge) must not be reachable from the page's script: the two worlds
    // talk through postMessage, not through imports.
    const isolatedOnly = [...mainWorld].filter((file) =>
      /^(ui|main|completion|run-lifecycle|sweep-snapshot|result-chunks)/.test(file),
    );
    expect(
      isolatedOnly,
      `isolated-world module in the MAIN world: ${isolatedOnly.join(", ")}`,
    ).toEqual([]);
  });
});
