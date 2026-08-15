# TypeScript 7 is the compiler; tooling consumes TypeScript 6 via the compatibility alias

TypeScript 7.0 (released July 2026) is a native port of the compiler written in Go — typically 8–12x faster on full builds — but, unlike every release before it, **it ships no JavaScript compiler API** (the new API is planned for 7.1). The old API lives on in the last JavaScript-based release, TypeScript 6.0, which Microsoft publishes as the compatibility package `@typescript/typescript6` (with a `tsc6` executable) so projects can keep running both side by side.

The project's toolchain splits exactly along that line:

- **CLI consumers** — `pnpm typecheck` runs the `tsc` binary; nothing imports the compiler programmatically there.
- **API consumers** — `@typescript-eslint` (parser + plugin) imports `typescript` at runtime to build the typed program from `tsconfig.json`; its peer dependency is `typescript >=4.8.4 <6.1.0`, so TypeScript 7's package (no API) cannot satisfy it.
- **Unaffected** — the build is esbuild bundling (`build.cjs`), tests transpile through vitest/esbuild; neither touches the TypeScript compiler API.

## Decision

Install TypeScript 7 as the compiler while keeping the `typescript` dependency name pinned to the 6.0 API, via two npm aliases:

```json
"@typescript/native": "npm:typescript@^7.0.2",    // tsc binary (Go-native, 8-12x faster)
"typescript": "npm:@typescript/typescript6@^6.0.2" // compiler API + tsc6, for typescript-eslint
```

This matches the official guidance from the TypeScript 7.0 announcement: `npx tsc` resolves to 7.0's binary from `@typescript/native`, while tools that `require("typescript")` (typescript-eslint) resolve to the 6.0 API package through the `typescript` alias. The compatibility package exposes only a `tsc6` bin, so there is no `.bin` collision; `pnpm exec tsc6` is available for anything that still wants the 6.0 CLI.

The `tsconfig.json` migration that went with it is forced by options TypeScript 7 removed:

- `moduleResolution: "node"` (node10) was removed → use `"bundler"`, which matches how this project actually resolves imports (esbuild bundles everything; there is no Node runtime resolution).
- `baseUrl` was removed, and `paths` entries must be relative → dropped both, because the `"*": ["src/*", "node_modules/*"]` mapping was never exercised (all source imports are relative paths or bare package specifiers like `xlsx`/`vitest`), and `"bundler"` already resolves bare specifiers against `node_modules`.

Beyond the forced removals, the config was modernized for a project whose emit is esbuild's job, not `tsc`'s: `noEmit: true` (and `outDir` dropped — it was dead config), plus `verbatimModuleSyntax` and `erasableSyntaxOnly` to guarantee every construct in the source is type-only and safely strip-pable by the bundler. `target`/`lib` stay at `ESNext` (browser runtime, no polyfill step) and `types` keeps `node` because `process.env.NODE_ENV` is still type-checked as-written — esbuild only replaces it at bundle time.

## Consequences

- `pnpm typecheck` runs the native compiler; expect the announced 8–12x speedup on full builds of larger codebases.
- `pnpm lint` continues to work against the TypeScript 6.0 API — the version range typescript-eslint actually supports. Do **not** bump `typescript` to `^7` directly: TS 7's package has no API and would break eslint with `Cannot find module 'typescript'`-class resolution failures.
- When upgrading TypeScript, advance both aliases in lockstep (7.x and 6.x); the 6.0 line will lag behind 7.x until 7.1 ships its new API and typescript-eslint adopts it.
- vitest, esbuild, and the extension build are unaffected by this decision.

Status: accepted.
