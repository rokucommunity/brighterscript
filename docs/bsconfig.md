# bsconfig.json options

While a minimal `bsconfig.json` file is sufficient for getting started, `bsc` supports a range of helpful options.

- [allowBrighterScriptInBrightScript](#allowBrighterScriptInBrightScript)
- [autoImportComponentScript](#autoImportComponentScript)
- [bslibDestinationDir](#bslibDestinationDir)
- [createPackage](#createPackage)
- [cwd](#cwd)
- [deploy](#deploy)
- [diagnosticFilters](#diagnosticFilters)
- [diagnosticLevel](#diagnosticLevel)
- [diagnosticSeverityOverrides](#diagnosticSeverityOverrides)
- [emitDefinitions](#emitDefinitions)
- [emitFullPaths](#emitFullPaths)
- [extends](#extends)
- [files](#files)
- [host](#host)
- [outFile](#outFile)
- [password](#password)
- [plugins](#plugins)
- [project](#project)
- [pruneEmptyCodeFiles](#pruneEmptyCodeFiles)
- [removeParameterTypes](#removeParameterTypes)
- [require](#require)
- [retainStagingDir](#retainStagingDir)
- [rootDir](#rootDir)
- [sourceRoot](#sourceRoot)
- [stagingDir](#stagingDir)
- [username](#username)
- [watch](#watch)

## `allowBrighterScriptInBrightScript`

Type: `boolean`

Allow BrighterScript features (classes, interfaces, etc...) to be included in BrightScript (`.brs`) files, and force those files to be transpiled.

## `autoImportComponentScript`

Type: `bool`

BrighterScript only: will automatically import a script at transpile-time for a component with the same name if it exists. Defaults to `false`.

## `bslibDestinationDir`

Type: `string`

Override the destination directory for the bslib.brs file.  Use this if you want to customize where the bslib.brs file is located in the staging directory.  Note that using a location outside of `source` will break scripts inside `source` that depend on bslib.brs.

Defaults to `source`.

## `createPackage`

Type: `boolean`

Causes the build to create a zip package. Defaults to `true`. This setting is ignored when [`deploy`](#deploy) is enabled.

## `cwd`

Type: `string`

If present, overrides the current working directory when invoking `bsc`. Defaults to `process.cwd()`.

## `deploy`

Type: `boolean`

If `true`, after a successful build, the project will be deployed to the Roku specified in host. Defaults to `false`. If this field is set to `true`, then the [`host`](#host) and [`password`](#password) fields must be set as well.

## `diagnosticFilters`

Type: `Array<string | number | {src: string; codes: number[]}`

A list of filters used to hide diagnostics.

- A `string` value should be a relative-to-root-dir or absolute file path or glob pattern of the files that should be excluded. Any file matching this pattern will have all diagnostics supressed. These file paths refer to the location of the source files pre-compilation and are relative to [`rootDir`](#rootdir). Absolute file paths may be used as well.
    - A file glob may be previxed with `!` to make it a negative pattern which "un-ignores" the files it matches. (See examples below).
- A `number` value should be a diagnostic code. This will supress all diagnostics with that code for the whole project.
- An object can also be provided to filter specific diagnostic codes for a file pattern. For example,

    ```jsonc
    "diagnosticFilters": [{
        "src": "vendor/**/*",
        "codes": [1000, 1011] //ignore these specific codes from vendor libraries
    }]
    ```

Defaults to `undefined`.

If a child bsconfig extends from a parent bsconfig, and both bsconfigs specify `diagnosticFilters`, the parent bsconfig's `diagnosticFilters` field will be completely overwritten.

### Negative patterns in `diagnosticFilters`

A negative pattern can be used to un-ignore some files or codes which were previously ignored. For example,

```jsonc
"diagnosticFilters": [
    { "src": "vendor/**/*" }, //ignore all codes from vendor libraries
    { "src": "!vendor/unreliable/**/*" } //EXCEPT do show errors from this one specific library
]
```

A specific error code can be unignored in multiple places by using a pattern which matches everything under `rootDir`. For example,

```jsonc
"diagnosticFilters": [
    { "src": "vendor/**/*" }, //ignore all errors from vendor libraries
    { "src": "!*/**/*", "codes": [1000] } //EXCEPT do show this particular code everywhere
]
```

The semantics of overriding match the way `git` treats `.gitignore` files: Negative patterns override earlier positive patterns, and positive patterns override earlier negative patterns.

## `diagnosticLevel`

Type: `"hint" | "info" | "warn" | "error"`

Specify what diagnostic levels are printed to the console. This has no effect on what diagnostics are reported in the LanguageServer. Defaults to `"warn"`.

## `diagnosticSeverityOverrides`

Type: `Record<string | number, 'hint' | 'info' | 'warn' | 'error'>`

A map of error codes and severity levels that will override diagnostics' severity. When a diagnostic generator doesn't offer enough control on an error's severity, this is a tool to work around blocking errors, or raise the level of other errors.

```jsonc
"diagnosticSeverityOverrides": {
    "1011": "error",   //raise a warning to an error
    "LINT1001": "warn" //oops we have lots of those to fix... later
}
```

## `emitDefinitions`

Type: `boolean`

Emit type definition files (`d.bs`) during transpile. Defaults to `false`.

## `emitFullPaths`

Type: `boolean`

Emit full paths to files when printing diagnostics to the console. Defaults to `false`.

## `extends`

Type: `string`

A `bsconfig.json` file can inherit configurations from another file using the `extends` property.

Relative or absolute path to another `bsconfig.json` file that this `bsconfig.json` file should import and then override. Prefix with a question mark (?) to prevent throwing an exception when the file does not exist (see [below](#optional-extends-and-project)). Defaults to `undefined`.

Child config properties completely replace parent config properties. For example: if a parent and child bsconfigs both specify an array for [`plugins`](#plugins), or [`files`](#files), or [`diagnosticFilters`](#diagnosticfilters), etc., then the parent's setting will be completely ignored and the child's setting will be used instead.

All relative paths found in the configuration file will be resolved relative to the configuration file they originated in.

### Optional `extends` and `project`
There are situations where you want to store some compiler settings in a config file, but not fail if that config file doesn't exist. To do this, you can denote that your [`extends`](#extends) or [`project`](#project) path is optional by prefixing it with a question mark (`?`). For example:

- **bsconfig.json** `extends`
    ```json
    {
      "extends": "?path/to/optional/bsconfig.json"
    }
    ```
- CLI "extends"
    ```
    bsc --extends "?path/to/optional/bsconfig.json"
    ```

- CLI `project` argument
    ```
    bsc --project "?path/to/optional/bsconfig.json"
    ```
- Node.js API `extends`
    ```
    var programBuilder = new ProgramBuilder({
        "extends": "?path/to/optional/bsconfig.json"
    });
    ```
- Node.js API `project`
    ```
    var programBuilder = new ProgramBuilder({
        "project": "?path/to/optional/bsconfig.json"
    });
    ```

## `files`

Type:
```typescript
Array<
  string |
  string[] |
  {
    src: string | string[],
    dest: string
  }>
```

The files array is how you specify what files are included in your project. Any strings found in the files array must be relative to rootDir, and are used as include filters, meaning that if a file matches the pattern, it is included.

For most standard projects, the default files array should work just fine:

```jsonc
{
    "files": [
        "source/**/*",
        "components/**/*",
        "images/**/*",
        "manifest"
    ]
}
```

This will copy all files from the standard roku folders directly into the package while maintaining each file's relative file path within [`rootDir`](#rootdir).

If you want to include additional files, you will need to provide the entire array. For example, if you have a folder with other assets, you could do the following:

```jsonc
{
    "files": [
        "source/**/*",
        "components/**/*",
        "images/**/*",
        "manifest"
        //your folder with other assets
        "assets/**/*",
    ]
}
```

If a `bsconfig.json` file specifies a parent config using the [`extends`](#extends) field, and the child specifies a `files` field, then the parent's `files` field will be completely overridden by the child.

### Excluding files

You can exclude files from the output by prefixing your file patterns with "!". This is useful in cases where you want everything in a folder EXCEPT certain files.

```jsonc
{
    "files": [
        "source/**/*",
        "!source/some/unwanted/file.brs"
    ]
}
```

The files array is processed from top to bottom, with later patterns overriding previous ones. This means that in order to exclude a file which is included by another pattern, the negative pattern using `!` must occur **after** the positive pattern.

### File pattern resolution

All patterns will be resolved relative to rootDir, with their relative positions within rootDir maintained.

Patterns may not reference files outside of [`rootDir`](#rootdir) unless the `{ src, dest }` form is used (see below). For example:

```jsonc
{
    "rootDir": "C:/projects/CatVideoPlayer",
    "files": [
        "source/main.brs",

        //NOT allowed because it navigates outside the rootDir
        "../common/promise.brs"
    ]
}
```

Any valid glob pattern is supported. For more information, see the documentation on the underlying [fast-glob](https://github.com/mrmlnc/fast-glob) library.

Empty folders are not copied.

Paths to folders will be ignored. If you want to copy a folder and its contents, use the glob syntax (i.e. `some_folder/**/*`).

### Specifying file destinations

For more advanced use cases, you may provide an object which contains the source pattern and output path. This allows you to be very specific about what files to copy, and where they are placed in the output folder. This option also supports copying files from outside the `rootDir`.

The object structure is as follows:

```typescript
{
    /**
     * A glob pattern string or file path, or an array of glob pattern strings and/or file paths.
     * These can be relative paths or absolute paths.
     * All non-absolute paths are resolved relative to the rootDir
     */
    src: Array<string | string[]>;
    /**
     * The relative path to the location in the output folder where the files should be placed,
     * relative to the root of the output folder
     */
    dest: string | undefined
}
```

If `src` is a non-glob path to a single file, then `dest` should include the filename and extension. For example:

```jsonc
{ "src": "lib/Promise/promise.brs", "dest": "source/promise.brs" }
```

If `src` is a glob pattern, then dest should be a path to the folder in the output directory. For example:

```jsonc
{ "src": "lib/*.brs", "dest": "source/lib" }
```

If `src` is a path to a folder, it will be ignored. If you want to copy a folder and its contents, use the glob syntax. The following example will copy all files from the lib/vendor folder recursively:

```jsonc
{ "src": "lib/vendor/**/*", "dest": "vendor" }
```

If `dest` is not specified it will default to the root of the output folder.

An example of combining regular and advanced file patterns:

```jsonc
{
    "rootDir": "C:/projects/CatVideoPlayer",
    "files": [
        "source/main.brs",
        {
          "src": "../common/promise.brs",
          "dest": "source/common"
        }
    ]
}
```

### File collision handling

Because file entries are processed in order you can override a file by specifying an alternative later in the files array.

For example, if you have a base project and a child project that wants to override specific files, you could do the following:

```jsonc
{
    "files": [
        {
            //copy all files from the base project
            "src": "../BaseProject/**/*"
        },
        // Override "../BaseProject/themes/theme.brs"
        // with "${rootDir}/themes/theme.brs"
        "themes/theme.brs"
    ]
}
```

## `host`

Type: `string`

The host of the Roku that this project will deploy to when the [`deploy`](#deploy) field is set to `true`. Defaults to `undefined`.

## `outFile`

Type: `string`

The path (including filename) where the output file should be placed. Defaults to `"./out/${WORKSPACE_FOLDER_NAME}.zip"`.

## `password`

Type: `string`

The password that will be used to deploy to the Roku device when the [`deploy`](#deploy) field is set to `true`. Defaults to `undefined`.

## `plugins`

Type: `Array<string>`

List of node scripts or npm modules to load as plugins to the BrighterScript compiler. Defaults to `undefined`.

If a child bsconfig extends from a parent bsconfig, and both bsconfigs specify a `plugins` field, the child's `plugins` field will completely overwrite the parent's `plugins` field.

## `project`

Type: `string`

A path to a project file. This is really only passed in from the command line or the NodeJS API, and should not be present in `bsconfig.json` files. Prefix with a question mark (?) to prevent throwing an exception when the file does not exist (see [example under the `extends` option](#optional-extends-and-project)).

## `pruneEmptyCodeFiles`

Type: `boolean`

Remove files from the final package which would be empty or consist entirely of comments after compilation. Also removes imports of any such empty scripts from XML files. This can speed up sideloading packages during development. Defaults to `false`.

## `removeParameterTypes`

Type: `boolean`

If true, removes the explicit type to function's parameters and return (i.e. the `as type` syntax); otherwise keep this information.

## `require`

Type: `Array<string>`

List of node scripts or npm modules to load during the startup sequence. Useful for running things like `ts-node/require`. Defaults to `undefined`.

If a child bsconfig extends from a parent bsconfig, and both bsconfigs specify a `require` field, the child's `require` field will completely overwrite the parent's `require` field.

## `retainStagingDir`

Type: `boolean`

Prevent the staging folder from being deleted after creating the package. Defaults to `false`, meaning that the folder is deleted every time.

## `rootDir`

Type: `string`

The root directory of your roku project. Defaults to `process.cwd()`.

## `sourceRoot`

Type: `string`

Override the root directory path where debugger should locate the source files. The location will be embedded in the source map to help debuggers locate the original source files. This only applies to files found within [`rootDir`](#rootdir). This is useful when you want to preprocess files before passing them to BrighterScript, and want a debugger to open the original files. This option also affects the `SOURCE_FILE_PATH` and `SOURCE_LOCATION` source literals.

## `stagingDir`

Type: `string`

The folder where the transpiled files are placed. This folder will be created automatically if it does not exist, and will be deleted after transpilation completes unless [`retainStagingDir`](#retainstagingdir) is set to `true`. Defaults to `./out/.roku-deploy-staging`.

## `username`

Type: `string`

The username that will be used to deploy to the Roku device when the [`deploy`](#deploy) field is set to `true`. Defaults to `undefined`.

## `watch`

Type: `boolean`

If `true`, the server will keep running and will watch and recompile on every file change. Defaults to `false`.
