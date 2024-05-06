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
    - For each physical file:
        - `beforeProvideFile`
        - `onProvideFile`
        - `afterProvideFile`
            - `beforeFileParse` (deprecated)
            - `afterFileParse` (deprecated)
    - For each physical and virtual file
        - `beforeAddFile`
        - `afterAddFile`
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
    /**
     * Called before a new program is created
     */
    beforeProgramCreate?(event: BeforeProgramCreateEvent): any;
    /**
     * Called after a new program is created
     */
    afterProgramCreate?(event: AfterProgramCreateEvent): any;


    /**
     * Called before the program gets prepared for building
     */
    beforePrepareProgram?(event: BeforePrepareProgramEvent): any;
    /**
     * Called when the program gets prepared for building
     */
    prepareProgram?(event: PrepareProgramEvent): any;
    /**
     * Called after the program gets prepared for building
     */
    afterPrepareProgram?(event: AfterPrepareProgramEvent): any;


    /**
     * Called before the entire program is validated
     */
    beforeProgramValidate?(event: BeforeProgramValidateEvent): any;
    /**
     * Called before the entire program is validated
     */
    onProgramValidate?(event: OnProgramValidateEvent): any;
    /**
     * Called after the program has been validated
     */
    afterProgramValidate?(event: AfterProgramValidateEvent): any;

    /**
     * Called right before the program is disposed/destroyed
     */
    beforeProgramDispose?(event: BeforeProgramDisposeEvent): any;

    /**
     * Emitted before the program starts collecting completions
     */
    beforeProvideCompletions?(event: BeforeProvideCompletionsEvent): any;
    /**
     * Use this event to contribute completions
     */
    provideCompletions?(event: ProvideCompletionsEvent): any;
    /**
     * Emitted after the program has finished collecting completions, but before they are sent to the client
     */
    afterProvideCompletions?(event: AfterProvideCompletionsEvent): any;


    /**
     * Called before the `provideHover` hook. Use this if you need to prepare any of the in-memory objects before the `provideHover` gets called
     */
    beforeProvideHover?(event: BeforeProvideHoverEvent): any;
    /**
     * Called when bsc looks for hover information. Use this if your plugin wants to contribute hover information.
     */
    provideHover?(event: ProvideHoverEvent): any;
    /**
     * Called after the `provideHover` hook. Use this if you want to intercept or sanitize the hover data (even from other plugins) before it gets sent to the client.
     */
    afterProvideHover?(event: AfterProvideHoverEvent): any;

    /**
     * Called after a scope was created
     */
    afterScopeCreate?(event: AfterScopeCreateEvent): any;

    beforeScopeDispose?(event: BeforeScopeDisposeEvent): any;
    onScopeDispose?(event: OnScopeDisposeEvent): any;
    afterScopeDispose?(event: AfterScopeDisposeEvent): any;

    beforeScopeValidate?(event: BeforeScopeValidateEvent): any;

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


    onGetSemanticTokens?: PluginHandler<OnGetSemanticTokensEvent>;
    //scope events
    onScopeValidate?(event: OnScopeValidateEvent): any;
    afterScopeValidate?(event: BeforeScopeValidateEvent): any;

    onGetCodeActions?(event: OnGetCodeActionsEvent): any;
    onGetSemanticTokens?(event: OnGetSemanticTokensEvent): any;


    /**
     * Called before plugins are asked to provide files to the program. (excludes virtual files produced by `provideFile` events).
     * Call the `setFileData()` method to override the file contents.
     */
    beforeProvideFile?(event: BeforeProvideFileEvent): any;
    /**
     * Give plugins the opportunity to handle processing a file. (excludes virtual files produced by `provideFile` events)
     */
    provideFile?(event: ProvideFileEvent): any;
    /**
     * Called after a file was added to the program. (excludes virtual files produced by `provideFile` events)
     */
    afterProvideFile?(event: AfterProvideFileEvent): any;


    /**
     * Called before a file is added to the program.
     * Includes physical files as well as any virtual files produced by `provideFile` events
     */
    beforeFileAdd?(event: BeforeFileAddEvent): any;
    /**
     * Called after a file has been added to the program.
     * Includes physical files as well as any virtual files produced by `provideFile` events
     */
    afterFileAdd?(event: AfterFileAddEvent): any;

    /**
     * Called before a file is removed from the program. This includes physical and virtual files
     */
    beforeFileRemove?(event: BeforeFileRemoveEvent): any;
    /**
     * Called after a file has been removed from the program. This includes physical and virtual files
     */
    afterFileRemove?(event: AfterFileRemoveEvent): any;


    /**
     * Called before each file is validated
     */
    beforeFileValidate?(event: BeforeFileValidateEvent): any;
    /**
     * Called during the file validation process. If your plugin contributes file validations, this is a good place to contribute them.
     */
    onFileValidate?(event: OnFileValidateEvent): any;
    /**
     * Called after each file is validated
     */
    afterFileValidate?(event: AfterFileValidateEvent): any;


    /**
     * Called right before the program builds (i.e. generates the code and puts it in the stagingDir
     */
    beforeBuildProgram?(event: BeforeBuildProgramEvent): any;
    /**
     * Called right after the program builds (i.e. generates the code and puts it in the stagingDir
     */
    afterBuildProgram?(event: AfterBuildProgramEvent): any;


    /**
     * Before preparing the file for building
     */
    beforePrepareFile?(event: BeforePrepareFileEvent): any;
    /**
     * Prepare the file for building
     */
    prepareFile?(event: PrepareFileEvent): any;
    /**
     * After preparing the file for building
     */
    afterPrepareFile?(event: AfterPrepareFileEvent): any;


    /**
     * Before the program turns all file objects into their final buffers
     */
    beforeSerializeProgram?(event: BeforeSerializeProgramEvent): any;
    /**
     * Emitted right at the start of the program turning all file objects into their final buffers
     */
    onSerializeProgram?(event: OnSerializeProgramEvent): any;
    /**
     * After the program turns all file objects into their final buffers
     */
    afterSerializeProgram?(event: AfterSerializeProgramEvent): any;


    /**
     * Before turning the file into its final contents
     */
    beforeSerializeFile?(event: BeforeSerializeFileEvent): any;
    /**
     * Turn the file into its final contents (i.e. transpile a bs file, compress a jpeg, etc)
     */
    serializeFile?(event: SerializeFileEvent): any;
    /**
     * After turning the file into its final contents
     */
    afterSerializeFile?(event: AfterSerializeFileEvent): any;


    /**
     * Called before any files are written
     */
    beforeWriteProgram?(event: BeforeWriteProgramEvent): any;
    /**
     * Called after all files are written
     */
    afterWriteProgram?(event: AfterWriteProgramEvent): any;


    /**
     * Before a file is written to disk. These are raw files that contain the final output. One `File` may produce several of these
     */
    beforeWriteFile?(event: BeforeWriteFileEvent): any;
    /**
     * Called when a file should be persisted (usually writing to storage). These are raw files that contain the final output. One `File` may produce several of these.
     * When a plugin has handled a file, it should be pushed to the `handledFiles` set so future plugins don't write the file multiple times
     */
    writeFile?(event: WriteFileEvent): any;
    /**
     * Before a file is written to disk. These are raw files that contain the final output. One `File` may produce several of these
     */
    afterWriteFile?(event: AfterWriteFileEvent): any;
}

// related types:
interface FileObj {
    src: string;
    dest: string;
}

interface TranspileObj {
    file: File;
    outputPath: string;
}

type ValidateHandler = (scope: Scope, files: File[], callables: CallableContainerMap) => void;
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

To add a diagnostic, register it with the `DiagnosticManager`, available from the `program` property of any event.

```typescript
// bsc-plugin-no-underscores.ts
import { CompilerPlugin, File, isBrsFile } from 'brighterscript';

// plugin factory
export default function () {
    return {
        name: 'no-underscores',
        // post-parsing validation
        afterFileValidate: (event: AfterFileValidateEvent) => {
            if (isBrsFile(event.file)) {
                // clear existing diagnostics
                event.program.diagnosticManager.clearByContext({file: file, tag: 'no-underscores-plugin'});

                // visit function statements and validate their name
                event.file.ast.walk(createVisitor({
                    FunctionStatement: (funcStmt) => {
                        if (funcStmt.tokens.name.text.includes('_')) {
                            event.program.diagnostics.register([{
                                code: 9000,
                                message: 'Do not use underscores in function names',
                                range: funcStmt.tokens.name.range,
                                file
                            }]);
                        }
                    }
                }, {
                    walkMode: WalkMode.visitStatements
                });
            }
        }
    } as CompilerPlugin;
};
```

## Modifying code
Sometimes plugins will want to modify code before the project is transpiled. While you can technically edit the AST directly at any point in the file's lifecycle, this is not recommended as those changes will remain changed as long as that file exists in memory and could cause issues with file validation if the plugin is used in a language-server context (i.e. inside vscode).

Instead, we provide an instace of an `Editor` class in the `beforeFileTranspile` event that allows you to modify AST before the file is transpiled, and then those modifications are undone `afterFileTranspile`.

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

Note: Comments are not regular nodes in the AST, so to visit comments, there is an additional requirement to specify
that the AST walk should also `visitComments`. In the case of comments, the first argument of the visitor function is a `Token`, not an `AstNode`.

```typescript
import { isBrsFile, createVisitor, WalkMode, BeforeFileTranspileEvent, CompilerPlugin } from 'brighterscript';

export default function plugin() {
    return {
        name: 'removeCommentAndPrintStatements',
        beforeFileTranspile: (event: BeforeFileTranspileEvent) => {
            if (isBrsFile(event.file)) {
                // visit functions bodies
                event.file.ast.walk(createVisitor({
                    PrintStatement: (statement) => {
                        //replace `PrintStatement` transpilation with empty string
                        event.editor.overrideTranspileResult(statement, '');
                    },
                    CommentToken: (_token, _parent, owner, key) => {
                        //remove comment tokens
                        event.editor.removeProperty(owner, key);
                    }
                }), {
                    walkMode: WalkMode.visitStatements | WalkMode.visitComments
                });
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

## File API
By default, BrighterScript only parses files that it knows how to handle. Generally this includes `.xml` files in the compontents folder, `.brs`, `.bs` and `.d.bs` files. Other files may be handled in the future, such as `manifest`, `.ts` and possibly more. All other files are loaded into the program as `AssetFile` types and have no special handling or processing.

Plugins can provide files by contributing a `provideFile` function. BrighterScript will perform all of its file providing (like for `.xml` or `.brs` files) at the end of `provideFile` once every plugin had a chance to provide their own files. If you need to handle files before brighterscript does (like if you wanted to parse the .brs file instead of letting BrighterScript do it), you should do this in the `provideFile` event.

Your plugin may want to add enhanced features for file types (such as parsing javascript and converting it to BrightScript). BrighterScript supports this by asking plugins to "`provide`" file objects for a given file path.

Here's a sample plugin showing how to handle this:

```typescript
import { ProvideFileEvent, CompilerPlugin, BrsFile } from 'brighterscript';

export default function plugin() {
    return {
        name: 'removeCommentAndPrintStatements',
        provideFile: (event: ProvideFileEvent) => {
            //convert all javascript files into .brs files (magically!)
            if (event.srcExtension === '.js') {
                //get the file contents as a string
                const jsCode = event.getFileData().toString();

                //somehow magically convert javascript code to brightscript code
                const brsCode = convertJsToBrsUsingMagic(jsCode);

                //create a new BrsFile which will hold the final brs code after the js file was parsed
                const file = event.fileFactory.BrsFile({
                    srcPath: event.srcPath,
                    //rename the .js extension to .brs
                    destPath: event.destPath.replace(/\.js$/, '.brs')
                });
                //parse the generated brs code
                file.parse(brsCode);

                //add this brs file to the event, which is how you "provide" the file
                event.files.push(file);
            }
        }
    } as CompilerPlugin;
}
```

### Multiple files
Plugins can also provide _multiple_ files from a single physical file. Consider this example:
```typescript


import { BeforeProvideFileEvent, CompilerPlugin, BrsFile, XmlFile, trim } from 'brighterscript';

export default function plugin() {
    return {
        name: 'componentPlugin',
        beforeProvideFile: (event: BeforeProvideFileEvent) => {
            // source/buttons.component.bs

            event.files
            //split a .component file into a .brs and a .xml file
            if (event.srcExtension === '.component') {
                //get the filename (we will use this as the component name)
                const componentName = path.basename(event.srcPath);
                //get the file contents as a string
                const code = event.getFileData().toString();

                //create a new BrsFile to act as the primary .brs script for this file
                const brsFile = event.factory.BrsFile({
                    srcPath: event.srcPath.replace(/\.component$/, '.brs'),
                    destPath: event.destPath.replace(/\.component$/, '.brs')
                });
                //parse the generated brs code
                brsFile.parse(code);
                //add this brs file to the event, which is how you "provide" the file
                event.files.push(brsFile);

                //create an XmlFile which will serve as the SceneGraph component for this file
                const xmlFile = event.fileFactory.XmlFile({
                    srcPath: event.srcPath.replace(/\.component$/, '.xml'),
                    destPath: event.destPath.replace(/\.component$/, '.xml')
                });
                xmlFile.parse(`
                    <component name="${componentName}">
                        <script uri="${event.destPath}" />
                    </component>
                `);
                //add this file to the event, which is how you "provide" the file
                event.files.push(xmlFile);
            }
        }
    } as CompilerPlugin;
}
```

### File Factory
Your plugin will be written against a specific version of BrighterScript. However, your plugin may be loaded by a different version of brighterscript (either by the brighterscript cli or through an editor like vscode). Running different versions of BrighterScript could cause issues in the file api.

To mitigate this, the `provideFile` events supply a `fileFactory`, which exposes the file classes from the runner's brighterscript version. When possible, use the file factories found in `event.fileFactory` instead of direct class constructors. (i.e. use `event.fileFactory.BrsFile` instead of `new BrsFile()`). By using the file factories, this ensures better interoperability between plugins and a wide range of brighterscript versions.

You can see examples of this in the previous code snippets above.

### Program changes
Historically, only `.brs`, `.bs`, and `.xml` files would be present in the `Program`. As a result of the File API being introduced, now all files included as a result of the bsconfig.json `files` array will be present in the program. Unhandled files will be loaded as generic `AssetFile` instances. This may impact plugins that aren't properly guarding against specific file types. Consider this plugin code:
```typescript
onFileValidate(event){
    if (isXmlFile(event.file)) {
        // do XmlFile work
    } else {
        // assume it's a BrsFile (bad!)
        // it could now be a .jpeg or .png
    }
}
```

If a plugin has code like this, it may start failing due to receiving an `AssetFile` or some plugin-contributed custom file type that it didn't expect. We recommend that plugin authors always guard their code with file-specific conditional checks.

### srcPath, destPath, and pkgPath
The file api introduces a breaking change related to file paths. Previously there were only `srcPath` and `pkgPath`. `pkgPath` historically contained the file path as you would reference it in your project, such as `source/main.bs`. However, there was no property to represent its final path on device (i.e. `source/main.brs`).

To mitigate this, and since the file api is already causing a few breaking changes, we decided to change the way file paths work. `srcPath` remains the same. However, `pkgPath` has been renamed to `destPath` to represent the path to the file as it exists in your brighterscript project _before_ transpilation. `pkgPath` will now represent the final path where the file will reside on-device.

Plugin authors need to refactor their plugins to use `file.destPath` instead of `file.pkgPath`. While `destPath` and `pkgPath` sometimes have the same value, plugin authors should always assume that the paths are different.

Here's a description of each path property in BrighterScript now that the file api has been released.

- **srcPath** - the absolute path to the source file. For example:<br/>
`C:\projects\YourRokuApp\source\main.bs"` or `"/usr/projects/YourRokuApp/source/main.bs"`
- **destPath** - the path where the file exists within the context of a brightscript project, relative to the root of the package/zip.
 This the path that brightscript engineers will use in their channel code. This should _not_ containing a leading slash or `pkg:/` scheme. For example:<br/>
 `"source/main.bs"`
- **pkgPath** - the final path where the file will reside on-device. For example:<br/>
 `"source/main.brs"`

Here's an example file showing all three paths:
```js
{
    //location in source project
    srcPath: "C:/projects/YourRokuApp/source/main.bs",
    //location in brighterscript program
    destPath: "source/main.bs"
    //location on device
    pkgPath: "source/main.brs"
}
```
