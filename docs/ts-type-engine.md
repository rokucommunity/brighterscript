# TypeScript type engine (prototype)

An experiment in using the TypeScript checker as BrighterScript's type engine instead of maintaining our own.
BrighterScript is lowered to TypeScript that is only type-checked (never run), TypeScript checks it, and the
diagnostics are mapped back onto the `.bs` source.

Nothing here is wired in by default. Try it in a project with:

```jsonc
// bsconfig.json
{ "plugins": ["brighterscript/dist/tsTypeEngine/TsTypeEnginePlugin"] }
```

Its diagnostics show up next to the built-in ones with source `bsc-ts` and codes like `ts2345`.

## How it works

All files are in `src/tsTypeEngine/`.

| File | Role |
| --- | --- |
| `TsEmitter.ts` | `BrsFile` AST → TypeScript text, plus source mappings (generated offset span → `.bs` offset span) |
| `Prelude.ts` | One shared `.d.ts`: BrightScript primitives, operator helpers, every Roku component/interface/node from `roku-types`, global functions, and a typed `CreateObject` |
| `TsTypeEngine.ts` | One TypeScript program per `Scope`, an incremental builder per scope, diagnostic mapping, message rewriting, hover |
| `TsTypeEnginePlugin.ts` | Registers the diagnostics in `afterValidateProgram` |
| `naming.ts` | Identifier lowering (lower-casing, `$`/`%`/`!`/`#`/`&` suffixes, reserved words) |

How each BrightScript rule is encoded:

- **Case-insensitivity**: every identifier, member and associative array key is lower-cased. Messages get the declared casing back from a name table.
- **Scopes**: each file is emitted once, as a script (not a module), so a scope's files share one global namespace like BrightScript.
  The emitted text doesn't depend on the scope, so it's cached per file and the parsed `SourceFile`s are shared by every scope's program.
  Only the checking happens per scope.
- **Variables that change type**: locals are hoisted as `let x;` with no type. TypeScript then infers the type at each point from the
  assignments ("evolving let"), and unions the types from different branches.
- **Numbers**: `integer`, `longinteger`, `float` and `double` are `number` with optional brands. They stay assignable to each other
  (BrightScript allows that) but keep their own names in messages.
- **Operators**: `+ - * /` etc. become calls to generic helpers (`$add`, `$arith`, `$compare`), so `"a" + 1` is an error and anything `dynamic` stays `dynamic`.
- **invalid**: `invalid` is `null`, and `=`/`<>` become `==`/`!=`, so `if x <> invalid` narrows `x`, including optional members.
- **Associative arrays**: `{...}` literals keep their known member types and also allow any other key.
- **`m`**: inside class methods `m` is `this`. Elsewhere it's dynamic.
- **Generics**: new syntax, parsed only in BrighterScript mode: `function f<T>(v as T) as T`, `interface Box<T>`, `class Stack<T>`,
  `Box<integer>`, `new Stack<string>()`. The built-in type engine ignores the type arguments.

## Findings

**Features come for free.** Generic inference (`first([1, 2])` returns an integer), generic interfaces and classes, union types,
narrowing on `<> invalid`, control-flow types for reassigned variables, `override` checks, and access modifiers work with no
type-system code of ours. The built-in engine can't do the generics or the `string or invalid` narrowing at all.

**Agreement with the existing engine**: `scripts/ts-type-engine-compare.ts` runs the 309 snippets in `ScopeValidator.spec.ts` that it
can extract through both engines. They agree on exactly which lines have errors in **223 (72%)**, with no tuning beyond the encoding above. The gaps:

- Not encoded yet (most of the remaining cases): XML component interfaces and `callfunc` argument/return types, `typecast m`,
  doc-comment `@param` types, special node field types (`rect2d`, ...), namespaces used as values.
- Real semantic differences: BrightScript converts numbers to booleans when passed as arguments, and allows some member access on
  unions in BrightScript mode. These need loosening in the prelude or emitter.
- Not type checks at all (observer callback names, variable shadowing, reserved words). Those would stay in the built-in validator.

**Performance** (`scripts/ts-type-engine-benchmark.ts`: 300 files / ~37k lines, 40 component scopes that each pull in 20 shared files):

| | built-in validate | TS engine |
| --- | --- | --- |
| Cold | ~2.5s | ~7.4s |
| Edit changing a declaration | ~0.1s | ~2.2s |
| Edit inside a function body | ~0.07s | ~0.07s |
| Heap | ~312MB | ~635MB |

TypeScript's incremental builder re-checks only the edited file when its declarations didn't change. When they did change, it
re-checks every file in every scope that includes the file, because global script files all depend on each other. A file in N scopes is
checked N times. Ideas if this goes further: check only open files in the language server, and run scopes in parallel across workers.

**Messages** read like TypeScript (`Argument of type 'string' is not assignable to parameter of type 'integer'`). Names and casing are
restored, `null`/`any`/`|` become `invalid`/`dynamic`/`or`, but errors from operators point at the helper's argument
("Argument of type 'number' is not assignable to parameter of type 'string'" for `"a" + 1`) instead of saying "operator + ...".

## Not done in the prototype

- Custom XML components as `roSGNode<Name>` types, with interface fields and `callfunc` signatures
- Replacing the built-in engine's type diagnostics (today both run side by side), and hover/completions in the language server
- Generic constraints (`<T extends Foo>`), explicit type arguments on calls (`identity<string>(x)`), and `typeParameters` on cloned ASTs
- `typescript` would have to move from `devDependencies` to `dependencies`, and probably to TS 5.x (the repo pins 4.7)
