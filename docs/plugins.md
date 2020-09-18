# BrighterScript plugins

The brighterscript compiler is extensible using **JavaScript** plugins.

## Configuration

### Declarative configuration

You can refer to scripts / npm modules directly in the `bsconfig.json`.

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
        - `afterFileValidate`
    - `beforeProgramValidate`
    - For each scope:
        - `beforeScopeValidate`
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
    afterFileParse?: (file: (BrsFile | XmlFile)) => void;
    afterFileValidate?: (file: (BrsFile | XmlFile)) => void;
    beforeFileTranspile?: (entry: TranspileObj) => void;
    afterFileTranspile?: (entry: TranspileObj) => void;
    beforeFileDispose?: (file: (BrsFile | XmlFile)) => void;
    afterFileDispose?: (file: (BrsFile | XmlFile)) => void;
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
    file: (BrsFile | XmlFile);
    outputPath: string;
}

type ValidateHandler = (scope: Scope, files: (BrsFile | XmlFile)[], callables: CallableContainerMap) => void;
interface CallableContainerMap {
    [name: string]: CallableContainer[];
}
interface CallableContainer {
    callable: Callable;
    scope: Scope;
}
```

## Plugin API

Plugins are JavaScript modules dynamically loaded by the compiler. Their entry point is a required default object following the `CompilerPlugin` interface and exposing event handlers.

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

// entry point
const pluginInterface: CompilerPlugin = {
    name: 'myDiagnosticPlugin',
    afterFileValidate
};
export default pluginInterface;

// post-parsing validation
function afterFileValidate(file: BrsFile | XmlFile) {
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
```

### Example AST modifier plugin

AST modification can be done after parsing (`afterFileParsed`), but it is recommended to modify the AST only before transpilation (`beforeFileTranspile`), otherwise it could cause problems if the plugin is used in a language-server context.

```typescript
// removePrint.ts
import { CompilerPlugin, Program, TranspileObj } from 'brighterscript';
import { EmptyStatement } from 'brighterscript/dist/parser';
import { isBrsFile, createStatementEditor, editStatements } from 'brighterscript/dist/parser/ASTUtils';

// entry point
const pluginInterface: CompilerPlugin = {
    name: 'removePrint',
    beforeFileTranspile
};
export default pluginInterface;

// transform AST before transpilation
function beforeFileTranspile(entry: TranspileObj) {
    if (isBrsFile(entry.file)) {
        // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
        entry.file.parser.functionExpressions.forEach((fun) => {
            const visitor = createStatementEditor({
                PrintStatement: (statement) => new EmptyStatement()
            });
            editStatements(fun.body, visitor);
        });
    }
}
```
