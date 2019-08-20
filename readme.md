# BrighterScript

A superset of Roku's BrightScript language. Compiles to standard BrightScript. 

[![Build Status](https://travis-ci.org/rokucommunity/brighterscript.svg?branch=master)](https://travis-ci.org/rokucommunity/brighterscript)
[![codecov](https://codecov.io/gh/rokucommunity/brighterscript/branch/master/graph/badge.svg)](https://codecov.io/gh/rokucommunity/brighterscript)
[![NPM Version](https://badge.fury.io/js/brighterscript.svg?style=flat)](https://npmjs.org/package/@rokucommunity/brighterscript)

The goal of this project is to bring new features and syntax enhancements to Roku's BrightScript language. It also supports parsing and validating standard BrightScript, so you don't even need to write a single line of `BrighterScript` code to benefit from this project. 

 **Disclaimer:** This is currently a **work in progress**. Use at your own risk, but feel free to raise any issues you may find. 

## Installation

### npm

```bash
npm install brightscript-language -g
```

## Usage

### Basic Usage

If your project structure exactly matches Roku's, and you run the command from the root of your project, then you can do the following: 

```bash
bsc 
```

That's it! It will find all files in your brightscript project, check for syntax and static analysis errors, and if there were no errors, it will produce a zip at `./out/project.zip`

### Advanced Usage

If you need to configure `bsc`, you can do so in two ways: 

1. Using command line arguments. 
    This tool can be fully configured using command line arguments. To see a full list, run `bsc --help` in your terminal.
2. Using a `bsconfig.json` file. See [the available options](#bsconfig.json-options) below. 
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
## bsconfig.json

### Overview
The presence of a `bsconfig.json` file in a directory indicates that the directory is the root of a BrightScript project. The `bsconfig.json` file specifies the root files and the compiler options required to compile the project.

### Configuration inheritance with `extends`

A `bsconfig.json` file can inherit configurations from another file using the `extends` property.

The extends is a top-level property in `bsconfig.json`. `extends`’ value is a string containing a path to another configuration file to inherit from.

The configuration from the base file are loaded first, then overridden by those in the inheriting config file. If a circularity is encountered, we report an error.

The `files` property from the inheriting config file overwrite those from the base config file.

All relative paths found in the configuration file will be resolved relative to the configuration file they originated in.


### bsconfig.json options

These are the options available in the `bsconfig.json` file. 

 - **project**: `string` - A path to a project file. This is really only passed in from the command line, and should not be present in `bsconfig.json` files

 - **extends**: `string` - Relative or absolute path to another `bsconfig.json` file that this `bsconfig.json` file should import and then override

 - **cwd**: `string` - Override the current working directory

 - **rootDir**: `string` - The root directory of your roku project. Defaults to current directory

 - **files**: ` (string | string[] | { src: string | string[]; dest?: string })[]` - The list file globs used to find all files for the project. If using the {src;dest;} format, you can specify a different destination directory for the matched files in src. 

 - **outFile**: `string` -  The path (including filename) where the output file should be placed (defaults to `"./out/[WORKSPACE_FOLDER_NAME].zip"`).
 
 - **skipPackage**: `boolean` - Prevents the zip file from being created. This has no effect if deploy is true. 

 - **watch**: `boolean` -  If true, the server will keep running and will watch and recompile on every file change.

 - **deploy**: `boolean` -  If true, after a success buld, the project will be deployed to the roku specified in host

 - **host**: `string` -  The host of the Roku that this project will deploy to

 - **username**: `string` - the username to use when deploying to a Roku device.

 - **password**: `string` - The password to use when deploying to a roku device.

 - **ignoreErrorCodes**: `number[]` - A list of error codes that the compiler should NOT emit, even if encountered. 

 - **emitFullPaths**: `boolean` -  Emit full paths to files when printing diagnostics to the console. Defaults to false


## Ignore errors and warnings on a per-line basis
In addition to disabling an entire class of errors in `bsconfig.json`, you may also disable errors for a subset of the complier rules within a file with the following comment flags:
 - `brs:disable-next-line`
 - `brs:disable-next-line: code1 code2 code3`
 - `brs:disable-line`
 - `brs:disable-line: code1 code2 code3`

Here are some examples:

```brightscript
sub Main()
    'disable errors about invalid syntax here
    'brs:disable-next-line
    DoSomething(

    DoSomething( 'brs:disable-line
    
    'disable errors about wrong parameter count
    DoSomething(1,2,3) 'brs:disable-next-line

    DoSomething(1,2,3) 'brs:disable-next-line:1002
end sub

sub DoSomething()
end sub
```

The primary motivation for implementing this feature was to provide a stopgap measure to hide errors on legitimate brightscript code. This is still a new project and it is likely to be missing support for certain BrightScript syntaxes. It is recommended that you only use these comments when absolutely necessary.

## Language Server Protocol

This project also contributes a class that aligns with Microsoft's [Language Server Protocol](https://microsoft.github.io/language-server-protocol/), which makes it easy to integrate `brightscript` with any IDE that supports the protocol. We won't go into more detail here, but you can use the `LanguageServer` class from this project to integrate into your IDE. The [vscode-brightscript-language](https://github.com/twitchbronbron/vscode-brightscript-language) extension uses this LanguageServer class for Visual Studio Code support. 

## Changelog
[Click here](CHANGELOG.md) to view the changelog.

## Special Thanks
Special thanks to the [brs](https://github.com/sjbarag/brs) project for its fantastic work on its blazing fast BrightScript parser. It was used as the foundation for the BrighterScript parser. 
