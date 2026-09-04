# BrighterScript - Copilot Instructions

Compiler (written in TypeScript) to transform BrighterScript (a superset of Roku's BrightScript) into valid BrightScript code.

## Architecture
- **Core**: Lexer → Parser → AST → Compiler
- **Patterns**: Visitor pattern for AST traversal, plugin-based extensibility
- **Key Classes**: `Program`, `Scope`, `Parser`, `Lexer`, `BrsFile`, `XmlFile`
- **Language Server**: Implements LSP for IDE features like autocompletion, diagnostics, and code navigation

## Key Directories
- `src/parser/` - Parser and AST nodes
- `src/lexer/` - Tokenization
- `src/files/` - File handlers (`BrsFile`, `XmlFile`)
- `src/lsp/` - Language Server Protocol implementation
- `src/astUtils/` - AST manipulation utilities (visitors, editors, creators)
- `src/bscPlugin/` - Built-in plugin (validation, completions, hover, code actions)
- `src/types/` - Type system implementation
- `src/validators/` - Validation rules

## Build Commands
- `npm run build` - Build the project (output to `dist/`)
- `npm run test:nocover` - Run tests without coverage (preferred for development; uses correct source maps)
- `npm run test` - Run tests with nyc coverage
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Run ESLint

> **Important**: Always run tests with `npm run test:nocover`. Do **not** invoke mocha directly with custom `--file` or `--spec` arguments — the `.mocharc.cjs` configuration must be respected.

## Code Style

### TypeScript Conventions
- PascalCase for classes and interfaces, camelCase for variables and functions
- Single quotes for strings (enforced by ESLint)
- Curly braces required for all control-flow blocks (`if`, `for`, `while`, etc.)
- One variable per declaration (`const x = 1; const y = 2;` — never `const x = 1, y = 2;`)
- Do **not** use object shorthand — write `{ foo: foo }` not `{ foo }` (enforced by ESLint: `object-shorthand: never`)
- Prefer `for...of` loops over index-based loops
- Always handle floating promises (no unhandled async operations)
- `strictNullChecks` is disabled — null/undefined checks are not enforced by the compiler
- `prefer-const` is off — use `let` or `const` based on context

### Imports
- Use `import type` for type-only imports
- Group imports: external packages first, then internal modules

### Comments
- JSDoc-style block comments (`/** ... */`) for public APIs and class members
- Inline comments for non-obvious logic

## Testing

### Framework & Conventions
- **Framework**: Mocha + Chai (`expect` assertions)
- **Test files**: `*.spec.ts`, colocated with the source file they test
- **Test helpers**: Import `expect` from `./chai-config.spec` (not directly from `chai`)
- Use `sinon` for mocks/stubs (sandbox created in `testHelpers.spec.ts` — auto-restored before/after each test)
- Use `undent` (aliased as `trim`) for multiline BrightScript strings in tests
- Helper functions `expectDiagnostics`, `expectZeroDiagnostics`, `expectDiagnosticsIncludes` are available from `testHelpers.spec.ts`

### Test Structure
```typescript
import { expect } from '../chai-config.spec';
import { expectZeroDiagnostics } from '../testHelpers.spec';

describe('MyFeature', () => {
    let subject: MyClass;

    beforeEach(() => {
        subject = new MyClass();
    });

    it('does something specific', () => {
        // arrange, act, assert
        expect(subject.result).to.equal('expected');
    });
});
```

## Common Patterns

### AST Modifications in Plugins
- Use `AstEditor` for reversible AST edits (automatically reverted after transpile)
- Visitor pattern for AST traversal via `createVisitor` from `astUtils/visitors`

### Diagnostics
- Create diagnostics via `DiagnosticMessages` for structured error codes and messages
- Always include a source `Range` (from `vscode-languageserver`) with diagnostics

### Plugin System
- Extend `PluginInterface` to hook into compiler lifecycle events
- The built-in `BscPlugin` in `src/bscPlugin/` is the reference implementation

### Error Recovery
- The parser is designed for IDE use — it must handle partial/invalid input gracefully
- Never throw fatal errors from the parser; emit diagnostics instead

## Notes
- Transpiled output must be valid BrightScript that runs on Roku devices
- BrighterScript is a strict superset of BrightScript
- Performance is critical — optimize AST traversal and use caching (`Cache` utility class)
- Test coverage is extensive; always add or update tests when modifying behavior
