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

### Plugin configuration objects

Instead of a plain string, a plugin entry can be an object with `src`, `name`, and `config` properties. This lets you pass plugin-specific configuration directly in `bsconfig.json`.

```json
{
    "plugins": [
        {
            "src": "./scripts/myPlugin.js",
            "name": "my-plugin",
            "config": {
                "severity": "error",
                "ignorePatterns": ["**/*.spec.bs"]
            }
        },
        {
            "src": "@rokucommunity/bslint",
            "config": "./path/to/bslint-config.json"
        }
    ]
}
```

The supported properties are:
- **`src`** *(required)* — the path to the plugin file or npm package name, same as the string shorthand.
- **`name`** *(optional)* — overrides the plugin's own `name` property. Useful for distinguishing multiple instances of the same plugin loaded with different configs.
- **`config`** *(optional)* — plugin-specific configuration, either:
  - **An inline object** — passed directly to the plugin.
  - **A path to a JSONC file** — the file is parsed and its contents are passed to the plugin. JSONC files support JavaScript-style comments (`//` and `/* */`). Paths in `bsconfig.json` are resolved relative to the `bsconfig.json` file's directory.

Both the string shorthand and the object form can be mixed in the same `plugins` array.

#### Example: JSONC config file

A JSONC config file lets you keep large or commented plugin configuration out of `bsconfig.json`. Given this `bsconfig.json`:

```json
{
    "plugins": [
        {
            "src": "@rokucommunity/bslint",
            "config": "./bslint.jsonc"
        }
    ]
}
```

…the referenced `bslint.jsonc` might look like this:

```jsonc
{
    // overall severity for all rules
    "severity": "error",

    // skip these files when linting
    "ignorePatterns": [
        "**/*.spec.bs",
        "source/generated/**/*.brs"
    ],

    "rules": {
        "no-print": "error",
        "no-underscores": "warn",
        /* allow `m.foo` style access in test files only */
        "consistent-this": "off"
    }
}
```

The compiler parses the file (comments and trailing commas allowed) and hands the resulting object to the plugin via `onSetConfiguration`.

### Receiving configuration in your plugin

The compiler calls the `onSetConfiguration` lifecycle hook on every plugin immediately after loading it, before any other lifecycle events fire. Plugins loaded via the string shorthand receive an empty object (`{}`); plugins loaded via the object form receive their resolved `config` value (or `{}` if no `config` was specified). Plugins may be reconfigured multiple times in watch mode if the `bsconfig.json` or plugin config files change.

```typescript
import type { CompilerPlugin } from 'brighterscript';

interface MyPluginConfig {
    severity?: 'error' | 'warn';
    ignorePatterns?: string[];
}

export default function () {
    return new MyPlugin();
}

class MyPlugin implements CompilerPlugin {
    public name = 'my-plugin';
    private config: MyPluginConfig = {};

    public onSetConfiguration(newConfig: MyPluginConfig) {
        this.config = newConfig;
    }

    public afterFileValidate(file) {
        // use this.config here
    }
}
```

### Usage on the CLI

Load plugins by path or package name with the existing `--plugins` (plural) flag:
```bash
npx bsc --plugins "./scripts/myPlugin.js" "@rokucommunity/bslint"
```

#### Naming a plugin from the CLI

Use the `--plugin` (singular) flag to load a plugin **and give it a name in the same flag**. The flag takes 1 or 2 positional values:

```bash
# --plugin <src>           — load a plugin (no inline name)
# --plugin <src> <name>    — load a plugin and assign it a name
```

Examples:

```bash
# Load @rokucommunity/bslint and name it "bslint" for CLI targeting
npx bsc --plugin "@rokucommunity/bslint" bslint

# Load a local script and name it "house-rules"
npx bsc --plugin ./scripts/customLinter.js house-rules

# Load multiple named plugins by repeating --plugin
npx bsc --plugin "@rokucommunity/bslint" bslint \
        --plugin ./scripts/customLinter.js house-rules

# Mix with --plugins (plural) — names from --plugin take effect on those entries only
npx bsc --plugins alpha beta charlie --plugin "@rokucommunity/bslint" bslint
```

The name you supply on the CLI is equivalent to the `name` field in a `bsconfig.json` plugin entry — it becomes the highest-priority identifier for `--plugin.<id>...` config overrides (see [How the `<id>` is resolved](#how-the-id-is-resolved) below).

```bash
# Load and name in one place, then override config keyed by that name
npx bsc --plugin "@rokucommunity/bslint" bslint --plugin.bslint.severity=error
```

If the name is omitted, the plugin's factory `name` and its src string remain available as fallback identifiers, exactly like a bare string entry in `bsconfig.json`.

A few details worth knowing:

- `--plugin <src>` consumes the next token as the name **only if** that token does not start with `-`. So `--plugin ./local.js --watch` is parsed as a single src-only entry; `--watch` is its own flag.
- `--plugin=<src>` (single-token form, with `=`) does **not** support an inline name — use the space-separated pair form when you need a name.
- The dotted form `--plugin.<id>.<prop>=<value>` is unaffected — it remains a *config override*, not a load directive.
- Plugin paths starting with `.` are resolved relative to the working directory, the same as `--plugins` entries.

#### Overriding plugin config from the CLI

Override individual plugin config properties using `--plugin.<id>.<prop>=<value>`:
```bash
npx bsc --plugin.my-plugin.severity=error --plugin.my-plugin.ignorePatterns="**/*.spec.bs"
```

Nested properties work too:
```bash
npx bsc --plugin.my-plugin.rules.noUnderscores=true
```

CLI overrides are deep-merged on top of whatever `config` the plugin has in `bsconfig.json`.

##### How the `<id>` is resolved

A plugin can be identified three different ways, and the `<id>` you write after `--plugin.` is matched against loaded plugins in this strict precedence order:

1. **bsconfig user-supplied `name`** — the `name` field on a plugin entry in `bsconfig.json`. This is the **highest priority**: if any loaded plugin's bsconfig entry has `name === <id>`, that plugin is the winner and other plugins are ignored — even if they have a factory name or src that also matches.
2. **Plugin factory `name`** — the `name` returned from the plugin's factory function (e.g. `return { name: 'bslint' }`). Only consulted when no bsconfig-name match was found. Plugins that already have a user-supplied bsconfig name are not eligible for factory-name targeting (the user renamed them deliberately).
3. **bsconfig `src`** — the path or package name string exactly as you wrote it in `bsconfig.json` (e.g. `"./scripts/myPlugin.js"` or `"@rokucommunity/bslint"`). Used as a final fallback for unnamed local scripts.

If an identifier matches multiple plugins at the chosen precedence level, the build fails with an error and you must set a unique `name` on the conflicting entries in `bsconfig.json` to disambiguate. Collisions at *lower* precedence levels are ignored when a *higher* level produced an unambiguous match.

###### Name priority examples

Given this `bsconfig.json`:

```json
{
    "plugins": [
        "@rokucommunity/bslint",
        { "src": "./scripts/customLinter.js", "name": "bslint" }
    ]
}
```

Both plugins happen to export `name: 'bslint'` from their factory. With the rules above:

```bash
# Targets ./scripts/customLinter.js only.
# The bsconfig user-supplied `name` "bslint" on the second entry wins outright;
# the factory-name match on the first entry is ignored.
npx bsc --plugin.bslint.severity=error

# Targets @rokucommunity/bslint only — match by bsconfig src.
npx bsc --plugin.@rokucommunity/bslint.severity=error

# Targets ./scripts/customLinter.js — also matched by bsconfig src.
npx bsc --plugin.\"./scripts/customLinter.js\".severity=error
```

If two entries shared the **same** user-supplied `name`, that's the case that fails:

```json
{
    "plugins": [
        { "src": "@rokucommunity/bslint", "name": "linter" },
        { "src": "./scripts/customLinter.js", "name": "linter" }
    ]
}
```

```bash
# Error: --plugin.linter is ambiguous. Rename one of the entries in bsconfig.json.
npx bsc --plugin.linter.severity=error
```

##### Ways to configure a plugin

There are three layers, each one optional, applied in this order:

1. **Inline `config` in `bsconfig.json`** — the base configuration that always applies.
2. **CLI total replacement** via a bare `--plugin.<id>=<value>` (no dotted property path) — *replaces* the bsconfig `config` entirely instead of merging on top of it. If `<value>` is a string that points to a JSONC file, the file is parsed and its contents become the new config.
3. **CLI property overrides** via `--plugin.<id>.<prop>=<value>` — deep-merged on top of whatever the layers above produced.

The order of CLI flags does not matter — total-replacement is always applied first, then merge overrides.

###### Examples

**1. Inline config in bsconfig only:**

```json
{
    "plugins": [
        {
            "src": "@rokucommunity/bslint",
            "config": { "severity": "warn", "rules": { "no-print": "error" } }
        }
    ]
}
```

The plugin receives `{ severity: 'warn', rules: { 'no-print': 'error' } }`.

**2. JSONC file referenced from bsconfig:**

```json
{
    "plugins": [
        { "src": "@rokucommunity/bslint", "config": "./bslint.jsonc" }
    ]
}
```

The plugin receives the parsed contents of `./bslint.jsonc`.

**3. Inline config + CLI merge overrides (most common):**

```json
{
    "plugins": [
        {
            "src": "@rokucommunity/bslint",
            "name": "bslint",
            "config": { "severity": "warn", "rules": { "no-print": "error", "no-underscores": "warn" } }
        }
    ]
}
```

```bash
npx bsc --plugin.bslint.severity=error --plugin.bslint.rules.no-underscores=off
```

The plugin receives:
```json
{
    "severity": "error",
    "rules": { "no-print": "error", "no-underscores": "off" }
}
```

`severity` was overridden, `rules.no-underscores` was overridden, and `rules.no-print` was preserved from bsconfig (deep merge).

**4. CLI total replacement (discards bsconfig config entirely):**

A bare `--plugin.<id>=<value>` has no dotted property path, so it is a *total replacement* and the bsconfig `config` is thrown away:

```json
{
    "plugins": [
        {
            "src": "@rokucommunity/bslint",
            "name": "bslint",
            "config": { "severity": "warn", "rules": { "no-print": "error" } }
        }
    ]
}
```

```bash
# The plugin receives the contents of ./ci-bslint.jsonc — the bsconfig `config` (severity, rules) is discarded entirely.
npx bsc --plugin.bslint=./ci-bslint.jsonc
```

If `./ci-bslint.jsonc` contains `{ "severity": "error" }`, the plugin receives exactly `{ "severity": "error" }` — *not* a merge with the bsconfig `config`.

**5. CLI total replacement + CLI merge on top:**

You can combine total replacement with merge overrides in a single command. The replacement is applied first (regardless of CLI order), then merges layer on top:

```bash
# Equivalent regardless of the order on the command line:
npx bsc --plugin.bslint=./ci-bslint.jsonc --plugin.bslint.severity=hint
npx bsc --plugin.bslint.severity=hint --plugin.bslint=./ci-bslint.jsonc
```

If `./ci-bslint.jsonc` is `{ "severity": "error", "rules": { "no-print": "warn" } }`, the plugin receives:
```json
{ "severity": "hint", "rules": { "no-print": "warn" } }
```

##### Quoting ids and properties with dots

Plugin ids and property names that contain dots can be double-quoted to prevent the dot being interpreted as a path separator. Any segment of the dotted key may be quoted:

```bash
# scoped npm package with no dot in the name — no quoting needed
npx bsc --plugin.@rokucommunity/bslint.enabled=false

# id with literal dots in it — quote the id segment
npx bsc --plugin.\"my-module.with.dots\".enabled=false

# property name with a dot — quote the property segment
npx bsc --plugin.bslint.\"rules.no-underscores\"=warn

# target a local script by its path (the path contains a `.`, so quote it)
npx bsc --plugin.\"./scripts/myPlugin.js\".enabled=true
```

> Plugin configuration objects are only supported in `bsconfig.json` — the CLI `--plugins` flag accepts string values only. To configure a plugin from the CLI, load it via `--plugins` (or `bsconfig.json`) and then use `--plugin.<id>...` flags to override its config.

### Programmatic configuration

When using the compiler API directly, plugins can directly reference your code:

```typescript
import { ProgramBuilder } from 'brighterscript';
import myPlugin from './myPlugin';

const builder = new ProgramBuilder();
builder.addPlugin(myPlugin);
builder.run(/*...*/);
```

## Creating a plugin
### Naming conventions
While there are no restrictions on plugin names, it helps others to find your plugin on npm when you follow these naming conventions:

- **Unscoped**: If your npm package name won’t be scoped (doesn’t begin with `@`), then the plugin name should begin with `bsc-plugin-`, such as `bsc-plugin-auto-findnode`.
- **Scoped**: If your npm package name will be scoped, then the plugin name should be in the format of `@<scope>/bsc-plugin-<plugin-name>` such as `@rokucommunity/bsc-plugin-auto-findnode` or even `@<scope>/bsc-plugin` such as `@maestro/bsc-plugin`.

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
export type CompilerPluginFactory = (options?: PluginFactoryOptions) => CompilierPlugin;

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

    /**
     * Called before the `provideDefinition` hook
     */
    beforeProvideDefinition?(event: BeforeProvideDefinitionEvent): any;
    /**
     * Provide one or more `Location`s where the symbol at the given position was originally defined
     * @param event
     */
    provideDefinition?(event: ProvideDefinitionEvent): any;
    /**
     * Called after `provideDefinition`. Use this if you want to intercept or sanitize the definition data provided by bsc or other plugins
     * @param event
     */
    afterProvideDefinition?(event: AfterProvideDefinitionEvent): any;


    /**
     * Called before the `provideReferences` hook
     */
    beforeProvideReferences?(event: BeforeProvideReferencesEvent): any;
    /**
     * Provide all of the `Location`s where the symbol at the given position is located
     * @param event
     */
    provideReferences?(event: ProvideReferencesEvent): any;
    /**
     * Called after `provideReferences`. Use this if you want to intercept or sanitize the references data provided by bsc or other plugins
     * @param event
     */
    afterProvideReferences?(event: AfterProvideReferencesEvent): any;


    /**
     * Called before the `provideDocumentSymbols` hook
     */
    beforeProvideDocumentSymbols?(event: BeforeProvideDocumentSymbolsEvent): any;
    /**
     * Provide all of the `DocumentSymbol`s for the given file
     * @param event
     */
    provideDocumentSymbols?(event: ProvideDocumentSymbolsEvent): any;
    /**
     * Called after `provideDocumentSymbols`. Use this if you want to intercept or sanitize the document symbols data provided by bsc or other plugins
     * @param event
     */
    afterProvideDocumentSymbols?(event: AfterProvideDocumentSymbolsEvent): any;


    /**
     * Called before the `provideWorkspaceSymbols` hook
     */
    beforeProvideWorkspaceSymbols?(event: BeforeProvideWorkspaceSymbolsEvent): any;
    /**
     * Provide all of the workspace symbols for the entire project
     * @param event
     */
    provideWorkspaceSymbols?(event: ProvideWorkspaceSymbolsEvent): any;
    /**
     * Called after `provideWorkspaceSymbols`. Use this if you want to intercept or sanitize the workspace symbols data provided by bsc or other plugins
     * @param event
     */
    afterProvideWorkspaceSymbols?(event: AfterProvideWorkspaceSymbolsEvent): any;


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

### PluginFactory
To register a plugin, you need to have a default export that returns a factory. BrighterScript will call this factory once for every instance of a program that needs the plugin. This means that you might have multiple instances of a plugin in one NodeJS process (one for each brighterscript project).

```typescript
export default function () {
    return {
        name: 'Name of your plugin'
    };
}
```

### BrighterScript v1 compatability
There is currently a v1 rewrite of BrighterScript which includes some significant breaking changes. This has caused challenges with brighterscript plugins, as you need to maintain separate versions for v0 and v1. You can utilize the `pluginOptions.version` property in your factory to determine what brighterscript version is running your plugin, and adjust accordingly.

This options object is only available starting with brighterscript `v0.69.4` and `v1.0.0-alpha.45`. It's important to support backwards compatibility that an `undefined` `version` value be treated as a v0 plugin.

Here's a small example:

```typescript
export default function (pluginOptions: PluginOptions) {
    if(semver.major(pluginOptions?.version) === '1') {
        return {
            name: 'v1 version of your plugin!'
        };
    } else {
        return {
            name: 'v0 version of your plugin'
        };
    }
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
