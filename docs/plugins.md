# BrighterScript Plugins

The brighterscript compiler is extensible using **JavaScript** plugins.

**NOTE**: The plugin system is currently in `alpha`. It's brand new, and while we hope there won't be any significant changes to the API, we reserve the right to change things before moving the plugin system out of `alpha`.

## Configuration

### Declarative configuration

You can refer to node scripts / npm modules directly in the `bsconfig.json`.

Those plugins will be loaded by the VSCode extension and can provide live diagnostics within the editor.

```json
{
    "plugins": [
        "./scripts/myPlugin.js",
        "@rokucommunity/bslint"
    ]
}
```

### Programmatic configuration

When using the compiler API directly, plugins can directly reference your code:

```typescript
import { ProgramBuilder } from 'brighterscript';
import myPlugin from './myPlugin';

const builder = new ProgramBuilder();
builder.addPlugin(myPlugin);
builder.run(/*...*/);
```

## Compiler events

Full compiler lifecycle:

- `beforeProgramCreate`
- `afterProgramCreate`
    - `afterScopeCreate` ("source" scope)
    - For each file:
        - `beforeFileParse`
        - `afterFileParse`
        - `afterScopeCreate` (component scope)
    - `beforeProgramValidate`
    - For each file:
        - `beforeFileValidate`
        - `onFileValidate`
        - `afterFileValidate`
    - For each scope:
        - `beforeScopeValidate`
        - `onScopeValidate`
        - `afterScopeValidate`
    - `afterProgramValidate`
- `beforePrepublish`
- `afterPrepublish`
- `beforePublish`
    - `beforeProgramTranspile`
    - For each file:
        - `beforeFileTranspile`
        - `afterFileTranspile`
    - `afterProgramTranspile`
- `afterPublish`

### Language server

Once the program has been validated, the language server runs a special loop - it never reaches the publishing steps.

When a file is removed:

- `beforeFileDispose`
- `beforeScopeDispose` (component scope)
- `afterScopeDispose` (component scope)
- `afterFileDispose`

When a file is added:

- `beforeFileParse`
- `afterFileParse`
- `afterScopeCreate` (component scope)
- `afterFileValidate`

When any file is modified:

- Remove file
- Add file

After file addition/removal (note: throttled/debounced):

- `beforeProgramValidate`
- For each invalidated scope:
    - `beforeScopeValidate`
    - `afterScopeValidate`
- `afterProgramValidate`

Code Actions
 - `onProgramGetCodeActions`

## Compiler API

Objects in the brighterscript compiler dispatch a number of events that you can listen to. These events allow you to peek / modify the objects that the compiler manipulates.

The top level object is the `ProgramBuilder` which runs the overall process: preparation, running the compiler (`Program`) and producing the output.

`Program` is the compiler itself; it handles the creation of program objects (`Scope`, `BrsFile`, `XmlFile`) and overal validation.

`BrsFile` is a `.brs` or `.bs` file; its AST can be modified by a plugin.

`XmlFile` is a component; it doesn't have a proper AST currently but it can be "patched".

`Scope` is a logical group of files; for instance `source` files, or each component's individual scope (XML definition, related components and imported scripts). A file can be included in multiple scopes.

> Files are superficially validated after parsing, then re-validated as part of the scope they are included in.

### API definition

```typescript
export type CompilerPluginFactory = () => CompilierPlugin;

export interface CompilerPlugin {
    name: string;
    beforeProgramCreate?: (builder: ProgramBuilder) => void;
    beforePrepublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    afterPrepublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    beforePublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    afterPublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    afterProgramCreate?: (program: Program) => void;
    beforeProgramValidate?: (program: Program) => void;
    afterProgramValidate?: (program: Program) => void;
    beforeProgramTranspile?: (program: Program, entries: TranspileObj[]) => void;
    afterProgramTranspile?: (program: Program, entries: TranspileObj[]) => void;
    afterScopeCreate?: (scope: Scope) => void;
    beforeScopeDispose?: (scope: Scope) => void;
    afterScopeDispose?: (scope: Scope) => void;
    beforeScopeValidate?: ValidateHandler;
    afterScopeValidate?: ValidateHandler;
    beforeFileParse?: (source: SourceObj) => void;
    afterFileParse?: (file: BscFile) => void;
    afterFileValidate?: (file: BscFile) => void;
    beforeFileTranspile?: (entry: TranspileObj) => void;
    afterFileTranspile?: (entry: TranspileObj) => void;
    beforeFileDispose?: (file: BscFile) => void;
    afterFileDispose?: (file: BscFile) => void;
}

// related types:
interface FileObj {
    src: string;
    dest: string;
}

interface SourceObj {
    pathAbsolute: string;
    source: string;
}

interface TranspileObj {
    file: (BscFile);
    outputPath: string;
}

type ValidateHandler = (scope: Scope, files: BscFile[], callables: CallableContainerMap) => void;
interface CallableContainerMap {
    [name: string]: CallableContainer[];
}
interface CallableContainer {
    callable: Callable;
    scope: Scope;
}
```

## Plugin API

Plugins are JavaScript modules dynamically loaded by the compiler. Their entry point is a default function that returns an object that follows the `CompilerPlugin` interface.

To walk/modify the AST, a number of helpers are provided in `brighterscript/dist/parser/ASTUtils`.

### Working with TypeScript

It is highly recommended to use TypeScript as intellisense helps greatly writing code against new APIs.

```bash
# install modules needed to compile a plugin
npm install brighterscript typescript @types/node

# transpile to JS (with source maps for debugging)
npx tsc myPlugin.ts -m commonjs --sourceMap

# add --watch for continuous transpilation
npx tsc myPlugin.ts -m commonjs --sourceMap --watch
```

### Example diagnostic plugins

Diagnostics must run every time it is relevant:

- Files have one out-of-context validation step (`afterFileValidate`),
- Scopes are validated once all the the files have been collected (`before/afterScopeValidate`).

Note: in a language-server context, Scope validation happens every time a file changes.

```typescript
// myDiagnosticPlugin.ts
import { CompilerPlugin, BrsFile, XmlFile } from 'brighterscript';
import { isBrsFile } from 'brighterscript/dist/parser/ASTUtils';

// plugin factory
export default function () {
    return {
        name: 'myDiagnosticPlugin',
        // post-parsing validation
        afterFileValidate: (file: BscFile) => {
            if (!isBrsFile(file)) {
                return;
            }
            // visit function statements and validate their name
            file.parser.functionStatements.forEach((fun) => {
                if (fun.name.text.toLowerCase() === 'main') {
                    file.addDiagnostics([{
                        code: 9000,
                        message: 'Use RunUserInterface as entry point',
                        range: fun.name.range,
                        file
                    }]);
                }
            });
        }
    } as CompilerPlugin;
};
```

## Modifying code
Sometimes plugins will want to modify code before the project is transpiled. While you can technically edit the AST directly at any point in the file's lifecycle, this is not recommended as those changes will remain changed as long as that file exists in memory and could cause issues with file validation if the plugin is used in a language-server context (i.e. inside vscode).

Instead, we provide an instace of an `AstEditor` class in the `beforeFileTranspile` event that allows you to modify AST before the file is transpiled, and then those modifications are undone `afterFileTranspile`.

For example, consider the following brightscript code:
```brightscript
sub main()
    print "hello <FIRST_NAME>"
end sub
```

Here's the plugin:

```typescript
import { CompilerPlugin, BeforeFileTranspileEvent, isBrsFile, WalkMode, createVisitor, TokenKind } from './';

// plugin factory
export default function () {
    return {
        name: 'removePrint',
        // transform AST before transpilation
        beforeFileTranspile: (event: BeforeFileTranspileEvent) => {
            if (isBrsFile(event.file)) {
                event.file.ast.walk(createVisitor({
                    LiteralExpression: (literal) => {
                        //replace every occurance of <FIRST_NAME> in strings with "world"
                        if (literal.token.kind === TokenKind.StringLiteral && literal.token.text.includes('<FIRST_NAME>')) {
                            event.editor.setProperty(literal.token, 'text', literal.token.text.replace('<FIRST_NAME>', 'world'));
                        }
                    }
                }), {
                    walkMode: WalkMode.visitExpressionsRecursive
                });
            }
        }
    } as CompilerPlugin;
};
```

This plugin will search through every LiteralExpression in the entire project, and every time we find a string literal, we will replace `<FIRST_NAME>` with `world`. This is done with the `event.editor` object. `editor` allows you to apply edits to the AST, and then the brighterscript compiler will `undo` those edits once the file has been transpiled.