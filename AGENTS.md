# BrighterScript

BrightScript is a BASIC-like language for Roku devices. BrighterScript is a superset that adds classes, namespaces, interfaces, enums, and type annotations — all of which transpile down to vanilla BrightScript. This repo is the compiler and language server that powers both.

**Repository:** [rokucommunity/brighterscript](https://github.com/rokucommunity/brighterscript)

## Build & Run

```bash
npm run build          # compile TypeScript (rimraf out && tsc)
npm run watch          # compile in watch mode
npm run lint           # eslint + EOL check
npm run format         # format with tsfmt
```

## Testing

```bash
npm run test:nocover   # run all tests without coverage
npm test               # run all tests with coverage (nyc mocha)
npm run test:watch     # run tests in watch mode
```

Never run a single test file. Always run the full suite.

- Test framework: **Mocha** + **Chai** (expect style) + **Sinon** for mocks/stubs
- Test files live next to source files as `*.spec.ts`
- Config: `.mocharc.cjs` (2s timeout, full trace)
- Import chai from `./chai-config.spec` (not directly from chai) to get project-specific config
- Common test helpers are in `src/testHelpers.spec.ts` (temp dirs, diagnostic assertions, etc.)

## Code Style & Conventions

- **Language:** TypeScript (strict mode, but `strictNullChecks: false`)
- **Module system:** CommonJS
- **Target:** ES2017
- **Quotes:** Single quotes (enforced by eslint)
- **Object shorthand:** Disabled — use `{ foo: foo }` not `{ foo }`
- **Semicolons:** Required (eslint default)
- **Curly braces:** Always required (`curly: error`)
- **`prefer-const`:** Off — `let` is acceptable even for never-reassigned variables
- **No `.only()` in tests:** `no-only-tests` eslint rule is enforced. This can be bypassed for running single tests, but must be restored prior to committing any code.
- **Floating promises:** `@typescript-eslint/no-floating-promises: error` — always `await` or `void` promises (prefer `await` over `void`)
- **`for-of` preferred** over index-based for-loops when iterating arrays

## Project Structure


Key entry points: `src/Program.ts` (core compiler), `src/ProgramBuilder.ts` (orchestration), `src/LanguageServer.ts` (LSP), `src/cli.ts` (CLI). Files are in `src/files/`, parsing in `src/parser/`, and the built-in plugin in `src/bscPlugin/` (with subdirs for validation, completions, hover, code actions, references, semantic tokens, symbols, and transpile).

## Compilation Pipeline

The high-level flow is: **parse → validate → transpile**.

1. `ProgramBuilder` orchestrates the overall build
2. Each `BrsFile`/`XmlFile` is parsed into an AST (`file.parse()`)
3. Files are assigned to `Scope`s (component scopes, namespace scopes) for cross-file validation
4. Plugins hook into each phase via `PluginInterface.ts` — the built-in plugin in `src/bscPlugin/` handles standard validation, completions, hover, etc.
5. Transpile converts BrighterScript AST back to plain BrightScript output

## Language Server
The project also contributes a language server which provides full editor features to clients like VSCode.

## Key Patterns

- **Plugin system:** Extend the compiler via `PluginInterface.ts`. The built-in plugin lives in `src/bscPlugin/`.
- **AST visitors:** Use `src/astUtils/visitors.ts` for walking/transforming the AST.
- **Diagnostic messages:** Defined centrally in `DiagnosticMessages.ts` as factory functions on the `DiagnosticMessages` object. Codes are sequential integers starting at 1000. When adding a new diagnostic, use the next available code after the highest existing one.
- **Path handling:** Use `util.standardizePath` (commonly aliased as `s`) for consistent cross-platform paths.
- **Test temp dirs:** Tests use `.tmp/rootDir` and `.tmp/stagingDir` — see `testHelpers.spec.ts`.
