# BrighterScript - Copilot Instructions

Compiler (written in TypeScript) to transform BrighterScript (a superset of Roku's BrightScript) into valid BrightScript code.

## Architecture
- **Core**: Lexer → Parser → AST → Compiler
- **Patterns**: Visitor pattern for AST traversal, plugin-based extensibility
- **Key Classes**: `Program`, `Scope`, `Parser`, `Lexer`, `BrsFile`, `XmlFile`
- **Language Server**: Implements LSP for IDE features like autocompletion, diagnostics, and code navigation

## Code Style
- TypeScript strict mode, PascalCase for classes, camelCase for variables
- `.spec.ts` for tests adjacent to source files
- Use `Diagnostic` class for errors/warnings with source locations

## Key Directories
- `src/parser/` - Parser and AST nodes
- `src/lexer/` - Tokenization
- `src/files/` - File handlers
- `src/lsp/` - Language server
- `src/astUtils/` - AST manipulation utilities

## Common Patterns
- Use `AstEditor` for safe AST modifications in plugins
- Visitor pattern for AST traversal (`astUtils/visitors`)
- Plugin system via `PluginInterface`
- Error recovery in parser for IDE experience

## Build Commands
- `npm run build` - Build project
- `npm run test:nocover` - Run tests without coverage but correct source maps
- `npm run lint` - Run ESLint

## Notes
- Transpiled code must be valid BrightScript syntax that runs on Roku devices
- BrighterScript is superset of BrightScript
- Performance-critical: optimize AST traversal and caching
