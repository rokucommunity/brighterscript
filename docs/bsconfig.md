# bsconfig.json options

While a minimal `bsconfig.json` file is sufficient for getting started, `bsc` supports a range of helpful options.

- [bsconfig.json options](#bsconfigjson-options)
  - [`allowBrighterScriptInBrightScript`](#allowbrighterscriptinbrightscript)
  - [`autoImportComponentScript`](#autoimportcomponentscript)
  - [`bslibDestinationDir`](#bslibdestinationdir)
  - [`createPackage`](#createpackage)
  - [`cwd`](#cwd)
  - [`deploy`](#deploy)
  - [`diagnosticFilters`](#diagnosticfilters)
    - [Negative patterns in `diagnosticFilters`](#negative-patterns-in-diagnosticfilters)
  - [`diagnosticLevel`](#diagnosticlevel)
  - [`diagnosticReporters`](#diagnosticreporters)
  - [`diagnosticSeverityOverrides`](#diagnosticseverityoverrides)
  - [`emitDefinitions`](#emitdefinitions)
  - [`emitFullPaths`](#emitfullpaths)
  - [`extends`](#extends)
    - [Optional `extends` and `project`](#optional-extends-and-project)
  - [`files`](#files)
    - [Excluding files](#excluding-files)
    - [File pattern resolution](#file-pattern-resolution)
    - [Specifying file destinations](#specifying-file-destinations)
    - [File collision handling](#file-collision-handling)
  - [`host`](#host)
  - [`minFirmwareVersion`](#minfirmwareversion)
    - [Line continuation in `.brs` files](#line-continuation-in-brs-files)
  - [`outFile`](#outfile)
  - [`password`](#password)
  - [`plugins`](#plugins)
  - [`project`](#project)
  - [`pruneEmptyCodeFiles`](#pruneemptycodefiles)
  - [`removeParameterTypes`](#removeparametertypes)
  - [`require`](#require)
  - [`retainStagingDir`](#retainstagingdir)
  - [`rootDir`](#rootdir)
  - [`sourceMap`](#sourcemap)
  - [`relativeSourceMaps`](#relativesourcemaps)
    - [`relativeSourceMaps: false` (default)](#relativesourcemaps-false-default)
    - [`relativeSourceMaps: true`](#relativesourcemaps-true)
  - [`sourceRoot`](#sourceroot)
  - [`stagingDir`](#stagingdir)
  - [`username`](#username)
  - [`watch`](#watch)

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
    - A file glob may be prefixed with `!` to make it a negative pattern which "un-ignores" the files it matches. (See examples below).
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

## `diagnosticReporters`

Type: `string | { type: string; format?: string } | Array<string | { type: string; format?: string }>`

Specify how diagnostics are reported to the console. Accepts a single value or an array; when given an array, each diagnostic is rendered once per entry (so you can, for example, emit detailed terminal output and GitHub Actions PR annotations from a single run). Defaults to `"detailed"`.

Each value can be:

- A **preset name**: `"detailed"` (the default rich, multi-line, colored output) or `"github-actions"` (one-line workflow commands like `::error file=...,line=...::message` so the GitHub Actions runner surfaces them as PR annotations).
- A **custom template string** containing at least one of the known placeholders. The placeholders supported are:

  | Placeholder      | Value |
  |------------------|---|
  | `{file}`         | file path (respects `emitFullPaths`) |
  | `{line}` / `{col}` | 1-based start line / column |
  | `{endLine}` / `{endCol}` | 1-based end line / column |
  | `{severity}`     | `error` / `warning` / `info` / `hint` |
  | `{severityCode}` | numeric LSP severity (1=error, 2=warning, 3=info, 4=hint) |
  | `{code}`         | diagnostic code (e.g. `1001`) |
  | `{message}`      | diagnostic message |
  | `{source}`       | diagnostic source (e.g. `brs`) |

  Unknown placeholders pass through unchanged so typos surface visually.
- An **explicit object** with `type`: `{ "type": "detailed" }`, `{ "type": "github-actions" }`, or `{ "type": "custom", "format": "<template>" }`.

Examples:

```jsonc
"diagnosticReporters": "detailed"

"diagnosticReporters": "github-actions"

// custom template
"diagnosticReporters": "{file}:{line}:{col} {severity} BS{code}: {message}"

// emit detailed terminal output AND github-actions annotations from the same run
"diagnosticReporters": ["detailed", "github-actions"]

// explicit object form (also accepts the same shapes inside an array)
"diagnosticReporters": { "type": "custom", "format": "{file}:{line}: {message}" }
```

If a value is invalid (typo'd preset, custom template with no known placeholders, etc.) it is logged as a warning and skipped. Duplicate entries are dropped with a warning message. If every configured reporter is invalid, the build falls back to `"detailed"` rather than failing.

The CLI accepts the same value (single or repeated):

```bash
bsc --diagnostic-reporters detailed
bsc --diagnostic-reporters detailed github-actions
bsc --diagnostic-reporters '{file}:{line}: {message}'
```

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

## `minFirmwareVersion`

Type: `string`

The minimum Roku firmware version required to run this project. When set, files are validated to ensure they only use language features available in that firmware version or earlier. BrightScript (`.brs`) files are always validated against the version restriction. BrighterScript (`.bs`) files are only validated for features that BrighterScript does not transpile — for example, optional chaining is emitted as-is rather than transpiled down, so it is subject to the version restriction. BrighterScript features that are fully transpiled (such as classes) are not restricted, since the transpiled output is compatible with older firmware.

Should be a semver-compatible string (e.g. `"11.0.0"` or `"11.0"`). Defaults to `undefined` (no version restriction).

**Example:**

```json
{
    "minFirmwareVersion": "11.0.0"
}
```

With this setting, using optional chaining (`?.`) without the version requirement being met will produce an error like:

> BrightScript feature 'optional chaining' requires Roku firmware version 11.0.0 or higher, but 'minFirmwareVersion' is set to 10.0.0

**Features gated by firmware version:**

| Feature | Minimum Version |
|---------|----------------|
| Optional chaining (`?.`, `?[`, `?(`) | 11.0.0 |
| Multi-line expressions / line continuation in `.brs` files | 15.3.0 |

### Line continuation in `.brs` files

In BrighterScript (`.bs`) files, multi-line expressions are supported because those constructs are transpiled away before reaching the device. In plain BrightScript (`.brs`) files, Roku OS 15.3 added native support for the same feature.

When `minFirmwareVersion` is set to `15.3` or higher, line continuation is enabled for `.brs` files as well:

```brs
' allowed in .brs files when minFirmwareVersion >= 15.3
sub main()
    result = firstValue +
             secondValue

    someFunction(
        arg1,
        arg2
    )
end sub
```

When `minFirmwareVersion` is below `15.3` (or is not set), line continuation in `.brs` files is still a parse error, while `.bs` files continue to support it regardless of the firmware version setting (because the output is transpiled).

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

## `sourceMap`

Type: `boolean`

Enables generating sourcemap files (`.map`), which allow debugging tools to show the original source code while running the emitted files. Defaults to `false`.

## `relativeSourceMaps`

Type: `boolean`

If `true`, file paths in the sourcemap `sources` array will be written as relative paths instead of absolute paths, and the behavior of [`sourceRoot`](#sourceroot) changes. Defaults to `false`.

This option only has an effect when [`sourceMap`](#sourcemap) is `true`.

### `relativeSourceMaps: false` (default)

This is the legacy behavior. Each entry in `sources[]` is an absolute path. If [`sourceRoot`](#sourceroot) is set, the `rootDir` portion of the path is replaced with `sourceRoot` directly inside `sources[]`. The map file's `sourceRoot` field is never written.

```jsonc
// sources[] with relativeSourceMaps: false, sourceRoot: undefined
"sources": ["/absolute/path/to/rootDir/source/main.bs"]

// sources[] with relativeSourceMaps: false, sourceRoot: "/my/source/server"
"sources": ["/my/source/server/source/main.bs"]  // rootDir swapped for sourceRoot
```

### `relativeSourceMaps: true`

Each entry in `sources[]` is a path relative to the map file's location. This makes sourcemaps portable across machines — useful when publishing build output as an npm package or sharing artifacts across CI environments.

If [`sourceRoot`](#sourceroot) is also set, the map file's `sourceRoot` field is written, and `sources[]` entries are made relative to `sourceRoot` instead of relative to the map file. Per the sourcemap spec, consumers reconstruct the full source path as `path.resolve(sourceRoot, sources[0])`.

```jsonc
// sources[] with relativeSourceMaps: true, sourceRoot: undefined
// map is at stagingDir/source/main.brs.map
"sources": ["../../rootDir/source/main.bs"]  // relative to the map file

// sources[] with relativeSourceMaps: true, sourceRoot: "/my/source/server"
"sourceRoot": "/my/source/server",
"sources": ["source/main.bs"]  // relative to sourceRoot; resolves to /my/source/server/source/main.bs
```

## `sourceRoot`

Type: `string`

Overrides where source files appear to live, both in sourcemaps and in the `SOURCE_FILE_PATH` / `SOURCE_LOCATION` runtime literals. Only applies to files within [`rootDir`](#rootdir) — files outside `rootDir` are unaffected.

The primary use case is preprocessing: if you transform files before passing them to BrighterScript, `sourceRoot` lets you point debuggers and runtime literals back to the original pre-processed sources.

The exact behavior depends on whether [`relativeSourceMaps`](#relativesourcemaps) is set:

- **`relativeSourceMaps: false` (default):** The `rootDir` portion of each source path is replaced with `sourceRoot` directly in `sources[]`. The map file's `sourceRoot` field is not written.
- **`relativeSourceMaps: true`:** The map file's `sourceRoot` field is set to this value, and `sources[]` entries are relative to `sourceRoot`. The `rootDir` portion of each source path is still replaced with `sourceRoot` when computing the relative path.

In both cases, `SOURCE_FILE_PATH` and `SOURCE_LOCATION` source literals embedded in the transpiled output will reflect the `sourceRoot`-substituted path at runtime.

## `stagingDir`

Type: `string`

The folder where the transpiled files are placed. This folder will be created automatically if it does not exist, and will be deleted after transpilation completes unless [`retainStagingDir`](#retainstagingdir) is set to `true`. Defaults to `./out/.roku-deploy-staging`.

## `username`

Type: `string`

The username that will be used to deploy to the Roku device when the [`deploy`](#deploy) field is set to `true`. Defaults to `undefined`.

## `watch`

Type: `boolean`

If `true`, the server will keep running and will watch and recompile on every file change. Defaults to `false`.
