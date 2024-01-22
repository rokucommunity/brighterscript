# BrighterScript

A superset of Roku's BrightScript language. Compiles to standard BrightScript.

[![build status](https://img.shields.io/github/actions/workflow/status/rokucommunity/brighterscript/build.yml?branch=master&logo=github)](https://github.com/rokucommunity/brighterscript/actions?query=branch%3Amaster+workflow%3Abuild)
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
    <a href="https://www.fubo.tv/">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/192530108-eb470b85-e687-4575-af69-254aab13428c.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="mailto:chris@inverted-solutions.com">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/197794500-2bac4903-ed00-463a-b243-24c68fba7962.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://www.applicaster.com/">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/192591901-20441fc8-3c6c-45ea-8851-b22430e6fb8e.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://www.redspace.com/">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/195908446-8d9652f8-9877-426f-b3c6-09119d788fd8.png">
    </a>&nbsp;&nbsp;&nbsp;
    <br/><br/>
      <a href="https://tantawowa.com/">
        <img height="38" src="https://user-images.githubusercontent.com/2544493/197795138-2ec870db-71fe-49e3-a014-692a3f31e6aa.png">
      </a>&nbsp;&nbsp;&nbsp;
     <a href="https://www.miraclechannel.ca/corcoplus">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/192593254-f2a32cd4-0482-40de-830d-c1d09690c46b.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://channelstore.roku.com/details/222212/phototv">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/169118062-81d94da5-2323-4e31-b19d-7db3f9c88dff.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://www.haystack.tv/">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/192610056-d1b5a382-edf4-47b9-a6a5-d2d3ee9094cb.png">
    </a>&nbsp;&nbsp;&nbsp;
</p>
<br/>

The BrighterScript project is used to power the popular [Brightscript Language](https://marketplace.visualstudio.com/items?itemName=rokucommunity.brightscript) VSCode extension, the [maestro framework](https://github.com/georgejecook/maestro/blob/master/docs/index.md), and more.

[Contact us](https://github.com/rokucommunity/brighterscript/issues/new) if you use BrighterScript in your project and would like your logo listed above. More projects are adopting BrighterScript all the time, from using the new BrighterScript language features to simply using the compiler in their build pipeline.

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
The presence of a `bsconfig.json` file in a directory indicates that the directory is the root of a BrightScript project. The `bsconfig.json` file specifies the root files and the compiler options required to compile the project. Here is a minimal example, which is recommended for new projects:

```jsonc
{
    "rootDir": "src",
    "files": [
        "**/*"
    ],
    "stagingFolderPath": "dist",
    "retainStagingFolder": true,
    //this flag tells BrighterScript that for every xml file, try to import a .bs file with the same name and location
    "autoImportComponentScript": true,
    "sourceMap": true
}
```

More information on the config file format may be found in the [bsconfig.json documentation](https://github.com/rokucommunity/BrighterScript/blob/master/docs/bsconfig.md).

## Suppressing compiler messages

The BrighterScript compiler emits errors and warnings when it encounters potentially invalid code. Errors and warnings may also be emitted by compiler plugins, such as by [the BrighterScript linter](https://github.com/rokucommunity/bslint). These messages can be suppressed if needed; see [the documentation](https://github.com/rokucommunity/BrighterScript/blob/master/docs/readme.md).

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
