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

### Usage on the CLI
```bash
npx bsc --plugins "./scripts/myPlugin.js" "@rokucommunity/bslint"
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
- `beforeProgramDispose`

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
- For each invalidated/not-yet-validated file
    - `beforeFileValidate`
    - `onFileValidate`
    - `afterFileValidate`
- For each invalidated scope:
    - `beforeScopeValidate`
    - `afterScopeValidate`
- `afterProgramValidate`

Code Actions
 - `onGetCodeActions`

Completions
 - `beforeProvideCompletions`
 - `provideCompletions`
 - `afterProvideCompletions`

Hovers
 - `beforeProvideHover`
 - `provideHover`
 - `afterProvideHover`

Semantic Tokens
 - `onGetSemanticTokens`


## Compiler API

Objects in the brighterscript compiler dispatch a number of events that you can listen to. These events allow you to peek / modify the objects that the compiler manipulates.

The top level object is the `ProgramBuilder` which runs the overall process: preparation, running the compiler (`Program`) and producing the output.

`Program` is the compiler itself; it handles the creation of program objects (`Scope`, `BrsFile`, `XmlFile`) and overal validation.

`BrsFile` is a `.brs` or `.bs` file; its AST can be modified by a plugin.

`XmlFile` is a component; it doesn't have a proper AST currently but it can be "patched".

`Scope` is a logical group of files; for instance `source` files, or each component's individual scope (XML definition, related components and imported scripts). A file can be included in multiple scopes.

> Files are superficially validated after parsing, then re-validated as part of the scope they are included in.

### API definition

Here are some important interfaces. You can view them in the code at [this link](https://github.com/rokucommunity/brighterscript/blob/ddcb7b2cd219bd9fecec93d52fbbe7f9b972816b/src/interfaces.ts#L190:~:text=export%20interface%20CompilerPlugin%20%7B).

```typescript
export type CompilerPluginFactory = () => CompilierPlugin;

export interface CompilerPlugin {
    name: string;
    //program events
    beforeProgramCreate?: (builder: ProgramBuilder) => void;
    beforePrepublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    afterPrepublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    beforePublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    afterPublish?: (builder: ProgramBuilder, files: FileObj[]) => void;
    afterProgramCreate?: (program: Program) => void;
    beforeProgramValidate?: (program: Program) => void;
    afterProgramValidate?: (program: Program) => void;
    beforeProgramTranspile?: (program: Program, entries: TranspileObj[], editor: AstEditor) => void;
    afterProgramTranspile?: (program: Program, entries: TranspileObj[], editor: AstEditor) => void;
    beforeProgramDispose?: PluginHandler<BeforeProgramDisposeEvent>;
    onGetCodeActions?: PluginHandler<OnGetCodeActionsEvent>;

    /**
     * Emitted before the program starts collecting completions
     */
    beforeProvideCompletions?: PluginHandler<BeforeProvideCompletionsEvent>;
    /**
     * Use this event to contribute completions
     */
    provideCompletions?: PluginHandler<ProvideCompletionsEvent>;
    /**
     * Emitted after the program has finished collecting completions, but before they are sent to the client
     */
    afterProvideCompletions?: PluginHandler<AfterProvideCompletionsEvent>;

    /**
     * Called before the `provideHover` hook. Use this if you need to prepare any of the in-memory objects before the `provideHover` gets called
     */
    beforeProvideHover?: PluginHandler<BeforeProvideHoverEvent>;
    /**
     * Called when bsc looks for hover information. Use this if your plugin wants to contribute hover information.
     */
    provideHover?: PluginHandler<ProvideHoverEvent>;
    /**
     * Called after the `provideHover` hook. Use this if you want to intercept or sanitize the hover data (even from other plugins) before it gets sent to the client.
     */
    afterProvideHover?: PluginHandler<AfterProvideHoverEvent>;

    onGetSemanticTokens?: PluginHandler<OnGetSemanticTokensEvent>;
    //scope events
    afterScopeCreate?: (scope: Scope) => void;
    beforeScopeDispose?: (scope: Scope) => void;
    afterScopeDispose?: (scope: Scope) => void;
    beforeScopeValidate?: ValidateHandler;
    onScopeValidate?: PluginHandler<OnScopeValidateEvent>;
    afterScopeValidate?: ValidateHandler;
    //file events
    beforeFileParse?: (source: SourceObj) => void;
    afterFileParse?: (file: BscFile) => void;
    /**
     * Called before each file is validated
     */
    beforeFileValidate?: PluginHandler<BeforeFileValidateEvent>;
    /**
     * Called during the file validation process. If your plugin contributes file validations, this is a good place to contribute them.
     */
    onFileValidate?: PluginHandler<OnFileValidateEvent>;
    /**
     * Called after each file is validated
     */
    afterFileValidate?: (file: BscFile) => void;
    beforeFileTranspile?: PluginHandler<BeforeFileTranspileEvent>;
    afterFileTranspile?: PluginHandler<AfterFileTranspileEvent>;
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

### Using ts-node to transpile plugin dynamically
The ts-node module can transpile typescript on the fly. This is by far the easiest way to develop a brighterscript plugin, as you can elimintate the manual typescript transpile step.

```bash
# install modules needed to compile a plugin
npm install brighterscript typescript @types/node ts-node -D

#run the brighterscript cli and use ts-node to dynamically transpile your plugin
npx bsc --sourceMap --require ts-node/register --plugins myPlugin.ts
```

The `require` flag can also be set in the `bsconfig.json`, simplifying your bsc command arguments.
```javascript
{
    "require": ["ts-node/register"]
}
```

### Transpiling manually
If you would prefer to transpile your plugin manually, you can follow these steps:

```bash
# install modules needed to compile a plugin
npm install brighterscript typescript @types/node -D

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
// bsc-plugin-no-underscores.ts
import { CompilerPlugin, BscFile, isBrsFile } from 'brighterscript';

// plugin factory
export default function () {
    return {
        name: 'no-underscores',
        // post-parsing validation
        afterFileValidate: (file: BscFile) => {
            if (isBrsFile(file)) {
                // visit function statements and validate their name
                file.parser.references.functionStatements.forEach((fun) => {
                    if (fun.name.text.includes('_')) {
                        file.addDiagnostics([{
                            code: 9000,
                            message: 'Do not use underscores in function names',
                            range: fun.name.range,
                            file
                        }]);
                    }
                });
            }
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
import { CompilerPlugin, BeforeFileTranspileEvent, isBrsFile, WalkMode, createVisitor, TokenKind } from 'brighterscript';

// plugin factory
export default function () {
    return {
        name: 'replacePlaceholders',
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

## Remove Comment and Print Statements

Another common use case is to remove print statements and comments. Here's a plugin to do that:
```typescript
import { isBrsFile, createVisitor, WalkMode, BeforeFileTranspileEvent, CompilerPlugin } from 'brighterscript';

export default function plugin() {
    return {
        name: 'removeCommentAndPrintStatements',
        beforeFileTranspile: (event: BeforeFileTranspileEvent) => {
            if (isBrsFile(event.file)) {
                // visit functions bodies and replace `PrintStatement` nodes with `EmptyStatement`
                for (const func of event.file.parser.references.functionExpressions) {
                    func.body.walk(createVisitor({
                        PrintStatement: (statement) => {
                            event.editor.overrideTranspileResult(statement, '');
                        },
                        CommentStatement: (statement) => {
                            event.editor.overrideTranspileResult(statement, '');
                        }
                    }), {
                        walkMode: WalkMode.visitStatements
                    });
                }
            }
        }
    } as CompilerPlugin;
}
```

## Modifying `bsconfig.json` via a plugin

In some cases you may want to modify the project's configuration via a plugin, such as to change settings based on environment variables or to dynamically modify the project's `files` array. Plugins may do so in the `beforeProgramCreate` step. For example, here's a plugin which adds an additional file to the build:
```typescript
import { CompilerPlugin, ProgramBuilder } from 'brighterscript';

export default function plugin() {
    return {
        name: 'addFilesDynamically',
        beforeProgramCreate: (builder: ProgramBuilder) => {
            if (!builder.options.files) {
                builder.options.files = [];
            }

            builder.options.files.push({
                src: "path/to/plugin/file.bs",
                dest: "some/destination/path/goes/here"
            })
        }
    } as CompilerPlugin;
}
```