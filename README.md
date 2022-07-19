# BrighterScript

A superset of Roku's BrightScript language. Compiles to standard BrightScript.

[![build status](https://img.shields.io/github/workflow/status/rokucommunity/brighterscript/build.svg?logo=github)](https://github.com/rokucommunity/brighterscript/actions?query=workflow%3Abuild)
[![coverage status](https://img.shields.io/coveralls/github/rokucommunity/brighterscript?logo=coveralls)](https://coveralls.io/github/rokucommunity/brighterscript?branch=master)
[![monthly downloads](https://img.shields.io/npm/dm/brighterscript.svg?sanitize=true&logo=npm&logoColor=)](https://npmcharts.com/compare/brighterscript?minimal=true)
[![npm version](https://img.shields.io/npm/v/brighterscript.svg?logo=npm)](https://www.npmjs.com/package/brighterscript)
[![license](https://img.shields.io/npm/l/brighterscript.svg)](LICENSE)
[![Slack](https://img.shields.io/badge/Slack-RokuCommunity-4A154B?logo=slack)](https://join.slack.com/t/rokudevelopers/shared_invite/zt-4vw7rg6v-NH46oY7hTktpRIBM_zGvwA)

## Overview

The BrighterScript language provides new features and syntax enhancements to Roku's BrightScript language. Because the language is a superset of BrightScript, the parser and associated tools (VSCode integration, cli, etc...) work with standard BrightScript (.brs) files. This means you will get benefits (as described in the following section) from using the BrighterScript compiler, whether your project contains BrighterScript (.bs) files or not. The BrighterScript language transpiles to standard BrightScript, so your code is fully compatible with all roku devices.

## Features
BrighterScript adds several new features to the BrightScript language such as Namespaces, classes, import statements, and more. Take a look at the language specification docs for more information.

[BrighterScript Language Specification](https://github.com/rokucommunity/BrighterScript/blob/master/docs/readme.md)

## Why use the BrighterScript compiler/CLI?

 - Check the entire project for syntax and program errors without needing to run on an actual Roku device.
 - Catch syntax and program errors at compile time which would not otherwise appear until runtime.
 - The compiler can be used as part of your tool-chains, such as continuous integration or a custom build pipeline.
 - Get real-time syntax validation by using the cli in `--watch` mode.

## Why use the BrighterScript language?

 - Brighterscript is in good hands:
    - The project is open source.
    - Brighterscript is designed by Roku developers, for Roku developers.
    - The project is owned by [RokuCommunity](https://github.com/rokucommunity) and the syntax and features are thoroughly thought out, discussed, and planned.
    - Actively developed.
 - Reduce boilerplate code and time debugging with language features like these:
    - [Import statements](https://github.com/rokucommunity/brighterscript/blob/master/docs/imports.md)
      - Declare import statements in scripts instead of xml script tags.
      - Automatically add script tags to XML components for all script import statements and their cascading dependencies
      - Missing imports are flagged at compile time.
    - [Classes](https://github.com/rokucommunity/brighterscript/blob/master/docs/classes.md)
      - Support for class inheritance and method overrides
      - Class fields and can be marked as `public`, `protected`, and `private` and incorrect access will be enforced by compile-time checks.
      - Class methods are automatically scoped to the class
    - [Namespaces](https://github.com/rokucommunity/brighterscript/blob/master/docs/namespaces.md):
      - Automatically add a name prefix to all methods inside a namespace block.
      - Prevents method naming collisions and improves code readability and maintainability.
      - Missing method invocations, and other namespace related syntax errors are reported at compile time.
    - [Ternary operator](https://github.com/rokucommunity/brighterscript/blob/master/docs/ternary-operator.md)
      - `username = m.user <> invalid ? m.user.name : "not logged in"`
    - [Template strings](https://github.com/rokucommunity/brighterscript/blob/master/docs/template-strings.md)
      - ```print `Hello ${firstNameVar}` ```.
    - [null-coalescing operator](https://github.com/rokucommunity/brighterscript/blob/master/docs/null-coalescing-operator.md)
      - `user = m.user ?? getDefaultUser()`
    - Additional Language features coming soon
      - null-conditional operator: `userSettings = m.user?.account?.profile?.settings`
    - and [more](https://github.com/rokucommunity/BrighterScript/blob/master/docs/readme.md)...


  - Full BrighterScript support for syntax checking, validation, and intellisense is available within the [Brightscript Language](https://marketplace.visualstudio.com/items?itemName=celsoaf.brightscript) VSCode extension.

  - And if it's not enough, the [plugin API](https://github.com/rokucommunity/brighterscript/blob/master/docs/plugins.md) allows extending the compiler to provide extra diagnostics or transformations.

## Who uses Brighterscript?
<br/>
<p align="center">
    <a href="https://www.applicaster.com/">
        <img src="https://user-images.githubusercontent.com/2544493/96571912-377af280-129a-11eb-8295-49eb12e54aeb.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://www.miraclechannel.ca/corcoplus">
        <img src="https://user-images.githubusercontent.com/2544493/157429644-ba0d574a-d3c3-425f-8e68-98103fb8f707.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://www.nba.com/">
        <img src="https://user-images.githubusercontent.com/2544493/157430017-a27b62d0-63de-4e87-a6df-8448007bd24d.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://channelstore.roku.com/details/222212/phototv">
        <img height="34" src="https://user-images.githubusercontent.com/2544493/169118062-81d94da5-2323-4e31-b19d-7db3f9c88dff.png">
    </a>&nbsp;&nbsp;&nbsp;
</p>
<br/>


The BrighterScript project is used to power the popular [Brightscript Language](https://marketplace.visualstudio.com/items?itemName=rokucommunity.brightscript) VSCode extension, the [maestro framework](https://github.com/georgejecook/maestro/blob/master/docs/index.md), and more.

[Contact us](https://github.com/rokucommunity/brighterscript/issues/new) if you use BrighterScript on your project and would like your logo listed above. More projects are adopting BrighterScript all the time, from using the new BrighterScript language features to simply using the compiler in their build pipeline.

## What's with the name?
The name BrighterScript is a compliment to everything that is great about Roku's awesome BrightScript language. Naming things is hard, and discoverability and recognizability are both very important. Here are the reasons we chose this name:
 - the `er` in BrighterScript represents the additional features we have added on top of BrightScript
 - It looks so similar to BrightScript, which is fitting because this language is 95% BrightScript, 5% extra stuff (the `er` bits).
 - The config file and extension look very similar between BrightScript and BrighterScript. Take `bsconfig.json` for example. While `brsconfig.json` might be more fitting for a pure BrightScript project, `bsconfig.json` is so very close that you probably wouldn't think twice about it. Same with the fact that `.bs` (BrighterScript) and `.brs` are very similar.

We want to honor BrightScript, the language that BrighterScript is based off of, and could think of no better way than to use _most_ of its name in our name.

## Installation

### npm

```bash
npm install brighterscript -g
```

## Usage

### Basic Usage

If your project structure exactly matches Roku's, and you run the command from the root of your project, then you can do the following:

```bash
bsc
```

That's it! It will find all files in your BrightScript project, check for syntax and static analysis errors, and if there were no errors, it will produce a zip at `./out/project.zip`

### Advanced Usage

If you need to configure `bsc`, you can do so in two ways:

1. Using command line arguments.
    This tool can be fully configured using command line arguments. To see a full list, run `bsc --help` in your terminal.
2. Using a `bsconfig.json` file. See [the available options](#bsconfigjson-options) below.
    By default, `bsc` looks for a `bsconfig.json` file at the same directory that `bsc` is executed. If you want to store your `bsconfig.json` file somewhere else, then you should provide the `--project` argument and specify the path to your `bsconfig.json` file.

### Examples

1. Your project resides in a subdirectory of your workspace folder.

    ```bash
    bsc --root-dir ./rokuSourceFiles
    ```
2. Run the compiler in watch mode

    ```bash
    bsc --watch
    ```

3. Run the compiler in watch mode, and redeploy to the roku on every change
    ```bash
    bsc --watch --deploy --host 192.168.1.10 --password secret_password
    ```
4. Use a bsconfig.json file not located at cwd
    ```bash
    bsc --project ./some_folder/bsconfig.json
    ```

5. Run the compiler as a **linter** only (watch mode supported)
    ```bash
    bsc --create-package false --copy-to-staging false
    ```

## bsconfig.json

### Overview
The presence of a `bsconfig.json` file in a directory indicates that the directory is the root of a BrightScript project. The `bsconfig.json` file specifies the root files and the compiler options required to compile the project.

### Configuration inheritance with `extends`

A `bsconfig.json` file can inherit configurations from another file using the `extends` property.

The extends is a top-level property in `bsconfig.json`. `extends`’ value is a string containing a path to another configuration file to inherit from.

The configuration from the base file are loaded first, then overridden by those in the inheriting config file. If a circularity is encountered, we report an error.

The `files` property from the inheriting config file overwrite those from the base config file.

All relative paths found in the configuration file will be resolved relative to the configuration file they originated in.

### Optional `extends` and `project`
There are situations where you want to store some compiler settings in a config file, but not fail if that config file doesn't exist. To do this, you can denote that your `extends` or `project` path is optional by prefixing it with a question mark (`?`). For example:

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

### bsconfig.json options

These are the options available in the `bsconfig.json` file.

 - **project**: `string` - A path to a project file. This is really only passed in from the command line or the NodeJS API, and should not be present in `bsconfig.json` files. Prefix with a question mark (?) to prevent throwing an exception when the file does not exist.

 - **extends**: `string` - Relative or absolute path to another `bsconfig.json` file that this `bsconfig.json` file should import and then override. Prefix with a question mark (?) to prevent throwing an exception when the file does not exist.

 - **cwd**: `string` - Override the current working directory

 - **rootDir**: `string` - The root directory of your roku project. Defaults to current directory

 - **files**: ` (string | string[] | { src: string | string[]; dest?: string })[]` - The list file globs used to find all files for the project. If using the {src;dest;} format, you can specify a different destination directory for the matched files in src.

 - **outFile**: `string` -  The path (including filename) where the output file should be placed (defaults to `"./out/[WORKSPACE_FOLDER_NAME].zip"`).

 - **createPackage**: `boolean` - Creates a zip package. Defaults to true. This setting is ignored when `deploy` is enabled.

 - **watch**: `boolean` -  If true, the server will keep running and will watch and recompile on every file change.

 - **deploy**: `boolean` -  If true, after a successful build, the project will be deployed to the Roku specified in host.

 - **host**: `string` -  The host of the Roku that this project will deploy to.

 - **username**: `string` - the username to use when deploying to a Roku device.

 - **password**: `string` - The password to use when deploying to a roku device.

 - **emitFullPaths**: `boolean` -  Emit full paths to files when printing diagnostics to the console. Defaults to false

 - **diagnosticFilters**: `Array<string | number | {src: string; codes: number[]}` - A list of filters used to hide diagnostics.
   - A `string` value should be a relative-to-root-dir or absolute file path or glob pattern of the files that should be excluded. Any file matching this pattern will have all diagnostics supressed.
   - A `number` value should be a diagnostic code. This will supress all diagnostics with that code for the whole project.
   - An object can also be provided to filter specific diagnostic codes for a file pattern. For example,
        ```jsonc
        "diagnosticFilters": [{
            "src": "vendor/**/*",
            "codes": [1000, 1011] //ignore these specific codes from vendor libraries
        }]
        ```
 - **diagnosticLevel**: `'hint' | 'info' | 'warn' | 'error'` - Specify what diagnostic levels are printed to the console. This has no effect on what diagnostics are reported in the LanguageServer. Defaults to 'warn'

 - **autoImportComponentScript**: `bool` - BrighterScript only: will automatically import a script at transpile-time for a component with the same name if it exists.

 - **sourceRoot**: `string` - Override the root directory path where debugger should locate the source files. The location will be embedded in the source map to help debuggers locate the original source files. This only applies to files found within rootDir. This is useful when you want to preprocess files before passing them to BrighterScript, and want a debugger to open the original files. This option also affects the `SOURCE_FILE_PATH` and `SOURCE_LOCATION` source literals.

 - **plugins**: `Array<string>` - List of node scripts or npm modules to load as plugins to the BrighterScript compiler.

 - **require**: `Array<string>` - List of node scripts or npm modules to load during the startup sequence. Useful for running things like `ts-node/require`

 - **allowBrighterScriptInBrightScript**: `boolean` - Allow brighterscript features (classes, interfaces, etc...) to be included in BrightScript (`.brs`) files, and force those files to be transpiled.


## Ignore errors and warnings on a per-line basis
In addition to disabling an entire class of errors in `bsconfig.json` by using `ignoreErrorCodes`, you may also disable errors for a subset of the complier rules within a file with the following comment flags:
 - `bs:disable-next-line`
 - `bs:disable-next-line: code1 code2 code3`
 - `bs:disable-line`
 - `bs:disable-line: code1 code2 code3`

Here are some examples:

```BrightScript
sub Main()
    'disable errors about invalid syntax here
    'bs:disable-next-line
    DoSomething(

    DoSomething( 'bs:disable-line

    'disable errors about wrong parameter count
    DoSomething(1,2,3) 'bs:disable-next-line

    DoSomething(1,2,3) 'bs:disable-next-line:1002
end sub

sub DoSomething()
end sub
```

The primary motivation for this feature was to provide a stopgap measure to hide incorrectly-thrown errors on legitimate BrightScript code due to parser bugs. This is still a new project and it is likely to be missing support for certain BrightScript syntaxes. It is recommended that you only use these comments when absolutely necessary.


## ropm support
In order for BrighterScript-transpiled projects to work as ropm modules, they need a reference to [bslib](https://github.com/rokucommunity/bslib/blob/master/source/bslib.brs) (the BrightScript runtime library for BrighterScript features) in their package. As `ropm` and `brighterscript` become more popular, this could result in many duplicate copies of `bslib.brs`.

To encourage reducing code duplication, BrighterScript has built-in support for loading `bslib` from [ropm](https://github.com/rokucommunity/ropm). Here's how it works:
1. if your program does not use ropm, or _does_ use ropm but does not directly reference bslib, then the BrighterScript compiler will copy bslib to `"pkg:/source/bslib.brs"` at transpile-time.
2. if your program uses ropm and has installed `bslib` as a dependency, then the BrighterScript compiler will _not_ emit a copy of bslib at `pkg:/source/bslib.brs`, and will instead use the path to the version from ropm `pkg:/source/roku_modules/bslib/bslib.brs`.


### Installing bslib in your ropm-enabled project
bslib is published to npm under the name [@rokucommunity/bslib](https://npmjs.com/package/@rokucommunity/bslib). If you use NodeJS version 12 or above, we recommend installing `@rokucommunity/bslib` with the `bslib` alias, as it produces smaller transpiled code (i.e. emits `bslib_` prefix instead of `rokucommunity_bslib_`). Here's the command to install bslib under the `bslib` alias using the ropm CLI.

```bash
ropm install bslib@npm:@rokucommunity/bslib
```

#### bslib support on NodeJS versions less than 12
npm aliases only work in NodeJS version 12 and above. If you're using a NodeJS version less than 12, you will need to install @rokucommunity/bslib directly without the alias. BrighterScript recognizes this pattern as well, it's just not preferred (for the reasons mentioned previously). Here's the command for that:
```bash
ropm install @rokucommunity/bslib
```

## Language Server Protocol

This project also contributes a class that aligns with Microsoft's [Language Server Protocol](https://microsoft.github.io/language-server-protocol/), which makes it easy to integrate `BrightScript` and `BrighterScript` with any IDE that supports the protocol. We won't go into more detail here, but you can use the `LanguageServer` class from this project to integrate into your IDE. The [vscode-BrightScript-language](https://github.com/rokucommunity/vscode-BrightScript-language) extension uses this LanguageServer class to bring `BrightScript` and `BrighterScript` language support to Visual Studio Code.

## Changelog
[Click here](CHANGELOG.md) to view the changelog.

## Special Thanks
Special thanks to the [brs](https://github.com/sjbarag/brs) project for its fantastic work on its blazing fast BrightScript parser which was used as the foundation for the BrighterScript parser.
