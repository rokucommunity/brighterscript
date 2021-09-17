# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



## [0.40.1](https://github.com/rokucommunity/brighterscript/compare/v0.40.0...v0.40.1) - 2021-09-17
### Changed
 - install roku-deploy@3.4.2 which prevents deploy crashes when target Roku doesn't have an installed channel ([roku-deploy#65](https://github.com/rokucommunity/brighterscript/compare/v0.39.4...v0.40.0))



## [0.40.0] - 2021-08-02
[0.40.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.39.4...v0.40.0
### Added
 - language support for Interface statements ([#426](https://github.com/rokucommunity/brighterscript/pull/426))
### Changed
 - cli prints the path of any loaded bsconfig.json on startup ([#434](https://github.com/rokucommunity/brighterscript/pull/434))



## [0.39.4] - 2021-06-27
[0.39.4]:   https://github.com/rokucommunity/brighterscript/compare/v0.39.3...v0.39.4
### Fixed
 - incorrect block range for inline if/then branch ([#424](https://github.com/rokucommunity/brighterscript/pull/424))
 - extract associative array comma when parsing ([#427](https://github.com/rokucommunity/brighterscript/pull/424))
 - allow up to 6 arguments in `CreateObject` function signature ([#430](https://github.com/rokucommunity/brighterscript/pull/430))
 - add v30/bslCore library functions to global callables ([#433](https://github.com/rokucommunity/brighterscript/pull/433))


## [0.39.3] - 2021-06-01
[0.39.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.39.2...v0.39.3
### Changed
 - upgraded to [roku-deploy@3.4.1](https://github.com/rokucommunity/roku-deploy/blob/master/CHANGELOG.md#341---2021-06-01) which fixes bugs introduced in roku-deploy@3.4.0



## [0.39.2] - 2021-05-28
[0.39.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.39.1...v0.39.2
### Changed
 - upgraded to [roku-deploy@3.4.0](https://github.com/rokucommunity/roku-deploy/blob/master/CHANGELOG.md#340---2021-05-28) which brings significant zip speed improvements



## [0.39.1] - 2021-05-24
[0.39.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.39.0...v0.39.1
### Changed
 - re-export `CodeActionKind` so plugins don't need to import from vscode-brightscript-language directly.
### Fixed
 - code action for "replace" tasks bug
 - include missing information in the CodeAction construction



## [0.39.0] - 2021-05-18
[0.39.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.38.2...v0.39.0
### Added
 - semantic token support for plugins
 - basic semantic tokens for `new` statements and namespace usage



## [0.38.2] - 2021-05-17
[0.38.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.38.1...v0.38.2
### Fixed
 - language server crash when namespaced function or class didn't have a name ([#419](https://github.com/rokucommunity/brighterscript/pull/419))



## [0.38.1] - 2021-05-14
[0.38.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.38.0...v0.38.1
### Changed
 - SOURCE_FILE_PATH and SOURCE_LOCATION source literals are now string concatenations in order to avoid triggering Roku's static analysis rule against `file:/` protocol strings ([#415](https://github.com/rokucommunity/brighterscript/pull/415))
### Fixed
 - ParseJson function signature to include second parameter ([#418](https://github.com/rokucommunity/brighterscript/pull/418))
 - bsconfig.schema.json support for string diagnostic codes ([#416](https://github.com/rokucommunity/brighterscript/pull/416))
 - upgrade chokidar to add `--watch` cli support for M1 mac computers  ([#386](https://github.com/rokucommunity/brighterscript/pull/386))
 - several dependency vulnerability fixes ([#413](https://github.com/rokucommunity/brighterscript/pull/413), [#410](https://github.com/rokucommunity/brighterscript/pull/410), [#411](https://github.com/rokucommunity/brighterscript/pull/411))



## [0.38.0] - 2021-05-04
### Added
 - warning for mismatched class method accessibility ([#402](https://github.com/rokucommunity/brighterscript/pull/402))
 - allow class field overrides in child classes as long as they are the same type ([#394](https://github.com/rokucommunity/brighterscript/pull/394))



## [0.37.4] - 2021-04-20
### Fixed
 - bug validating namespace function calls ([#390](https://github.com/rokucommunity/brighterscript/pull/390))



## [0.37.3] - 2021-04-12
### Fixed
 - bug where having multiple components with the same name would cause issues in the program, normally requiring a language server or watcher restart. ([#353](https://github.com/rokucommunity/brighterscript/pull/353))
 - bug in xml file ignoring `needsTranspiled` flag when set by plugins ([#384](https://github.com/rokucommunity/brighterscript/pull/384))



## [0.37.2] - 2021-04-08
### Fixed
 - erraneous syntax issue when concatenating a template string and a regular string. ([#383](https://github.com/rokucommunity/brighterscript/pull/383))
 - prevent circular import causing stack overflow crash. ([#381](https://github.com/rokucommunity/brighterscript/pull/381))



## [0.37.1] - 2021-03-30
### Fixed
 - bug when transpiling print statements that wouldn't retain the existing separators (semicolon, comma, no separator) which all have unique uses ([#373](https://github.com/rokucommunity/brighterscript/pull/373))



## [0.37.0] - 2021-03-18
### Added
 - support for `bs:disable` comments in xml files ([#363](https://github.com/rokucommunity/brighterscript/pull/363))



## [0.36.0] - 2021-03-15
### Added
 - class import code actions ([#365](https://github.com/rokucommunity/brighterscript/pull/365))
### Changed
 - append stack trace to every language server error ([#354)](https://github.com/rokucommunity/brighterscript/pull/354))
### Fixed
 - restrict function and class imports to .bs files only ([#365)](https://github.com/rokucommunity/brighterscript/pull/365))
 - language server crashes due to unsafe property access in callfunc expressions ([#360)](https://github.com/rokucommunity/brighterscript/pull/360))
 - crashes in signature help ([#358)](https://github.com/rokucommunity/brighterscript/pull/358))
 - template string transpile bug when two expressions were next to each other ([#361)](https://github.com/rokucommunity/brighterscript/pull/361))



## [0.35.0] - 2021-03-09
### Added
 - code actions for suggesting import statements in brighterscript files ([#347](https://github.com/rokucommunity/brighterscript/pull/347))
### Fixed
 - safer access to nullable callables and values during certain language server operations ([#328](https://github.com/rokucommunity/brighterscript/pull/328))



## [0.34.3] -2021-03-05
### Fixed
 - bug when transpiling bsc with custom function and parameter return types



## [0.34.2] - 2021-03-04
### Added
 - support for loading bslib without alias (i.e. `@rokucommunity/bslib`).
### Fixed
 - bslib npm alias bug crashing npm install on nodeJS < 12
 - infinite loop during transpile when copying bslib
 - bug where bslib.brs functions were not properly prefixed during transpile



## [0.34.1] - 2021-03-02
### Fixed
 - syntax parsing bugs within single-line if statements



## [0.34.0] - 2021-02-28
### Added
 - language server file path completions inside strings that start with `pkg:` or `libpkg:`



## [0.33.0] - 2021-02-27
### Added
 - support for ropm version of bslib.([#334](https://github.com/rokucommunity/brighterscript/pull/334))
### Fixed
 - parse crash when encountering immediately-invoked function expressions (IIFEs) ([#343](https://github.com/rokucommunity/brighterscript/pull/343))
 - error during language server completions when activated on the first token in the file ([#342](https://github.com/rokucommunity/brighterscript/pull/342))
 - refactored BrsFile.parseMode to be a property instead of a getter since there was no reason it needed to be a getter ([#341](https://github.com/rokucommunity/brighterscript/pull/341))



## [0.32.3] - 2021-02-25
### Fixed
 - fix significant performance bug in diagnostic filtering
 - tweaks to the logging system to make `logLevel=verbose` less chatty
 - null reference error in `Scope.getFileByRelativePath()`
 - fix class fields that were missing in getSymbol requests



## [0.32.2] - 2021-02-20
### Fixed
 - transpile bug when a template string starts with an expression ([#327](https://github.com/rokucommunity/brighterscript/pull/327))



## [0.31.2] - 2021-02-18
### Changed
 - parent class names in typedefs for class `extends` expressions now always include their full namespace name.



## [0.31.1] - 2021-02-18
### Fixed
 - prevent exception in codeAction functionality when file cannot be found in a `Program`



## [0.31.0] - 2021-02-17
### Added
 - plugin and language server support for [codeActions](https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_codeAction)
 - codeAction to add missing `extends` attribute in components
### Fixed
 - wrong line numbers in certain sourcemaps generated during transpile
 - include annotations in emitted type definitions



## [0.30.9] - 2021-02-15
### Fixed
 - prevent excess validations when non-workspace files are changed  ([#315](https://github.com/rokucommunity/brighterscript/pull/315))
 - catch errors when getting signatures ([#285](https://github.com/rokucommunity/brighterscript/pull/285))
 - missing `Roku_Ads` function in global functions list. ([#312](https://github.com/rokucommunity/brighterscript/pull/312))



## [0.30.8] - 2021-02-12
### Changed
 - add additional logging in `Program.removeFile`
### Fixed
 - Fix watcher bug on windows devices
 - Don't mangle xml scripts during transpile



## [0.30.7] - 2021-02-11
### Fixed
 - bug in `getSignatureHelp` that wouldn't work for function calls with no leading whitespace. ([#307](https://github.com/rokucommunity/brighterscript/issues/307))



## [0.30.6] - 2021-02-07
### Fixed
 - bad transpile for nested class method super calls
 - SceneGraph node attributes being wrongly removed when modifying attributes



## [0.30.5] - 2021-02-03
### Added
 - syntax support for dim statements
 - completion and code navigation for labels
### Fixed
 - exception related to signature help when writing comments



## [0.30.4] - 2021-02-02
### Fixed
 - fixed crash during validation caused by a missing function body when parsing malformed code



## [0.30.3] - 2021-02-01
### Fixed
 - performance issue when transpiling larger projects, even when no brighterscript code was used



## [0.30.2] - 2021-01-31
### Fixed
 - xml parse error crashing validation ((#294)[https://github.com/rokucommunity/brighterscript/pull/294])
 - better handling for `createStringLiteral` ((#292)[https://github.com/rokucommunity/brighterscript/pull/292])



## [0.30.1] - 2021-01-29
### Fixed
 - bug that would crash while transpiling if a script tag didn't have a `type` attribute
 - XML transpile now honors the `sourceMap` option



## [0.30.0] - 2021-01-26
### Added
 - null coalescing operator (see [the docs](https://github.com/rokucommunity/brighterscript/blob/master/docs/null-coalescing-operator.md) for more information)
### Fixed
 - infinite loop when encountering annotations without an identifier above a class method ([#291](https://github.com/rokucommunity/brighterscript/pull/291))



## [0.29.0] - 2021-01-25
### Added
 - ternary operator (see [the docs](https://github.com/rokucommunity/brighterscript/blob/master/docs/ternary-operator.md) for more information)



## [0.28.2] - 2021-01-22
### Changed
 - config loading functions from `util.ts` are now run synchronously
### Fixed
 - missing variable from `for each` statement in completions for language server
 - bug when running the CLI that wouldn't properly read the `sourceMap` property from bsconfig.json



## [0.28.1] - 2021-01-19
### Changed
 - (For plugin authors) refactored many async methods into sync methods to simplify file creation/management. ([#278](https://github.com/rokucommunity/brighterscript/pull/278))
### Fixed
 - bug with transpiling classes that would not always get the correct superclass index. ([#279](https://github.com/rokucommunity/brighterscript/pull/279))
 - annotations are now block-restricted ([#274](https://github.com/rokucommunity/brighterscript/pull/274))



## [0.28.0] - 2021-01-16
### Added
 - annotation support for classes and class methods ([#270](https://github.com/rokucommunity/brighterscript/pull/270))
### fixed
 - bugs with go-to-definition and signature help for namespace functions, classes, and callfunc calls



## [0.27.0] - 2021-01-15
### Changed
 - plugin system changed to require a factory function instead of a singleton object ([#272](https://github.com/rokucommunity/brighterscript/pull/272))



## [0.26.0] - 2021-01-14
### Added
 - proper XML AST support
 - component interface validation
 - basic support for string-based diagnostic codes (from plugins)



## [0.25.0] - 2021-01-12
### Added
 - support for passing custom types as function parameters and return types ([#262](https://github.com/rokucommunity/brighterscript/issues/262))



## [0.24.2] - 2021-01-11
### Fixed
 - bug with transpiled child classes causing on-device stack overflows ([#267](https://github.com/rokucommunity/brighterscript/issues/267))



## [0.24.1] - 2021-01-09
### Changed
 - upgraded to [roku-deploy@3.2.4](https://github.com/rokucommunity/roku-deploy/blob/master/CHANGELOG.md#324---2021-01-08)



## [0.24.0] - 2021-01-08
### Added
 - `sourceMap` option to enable/disable generating sourcemaps
### Changed
 - sourcemaps are disabled by default (previously they were enabled by default)



## [0.23.2] - 2020-01-06
### Fixed
 - `isLiteralInvalid` was causing infinite recursion.
 - lock `vscode-languageserver-protocol` package version to prevent issues with vscode not following semantic versioning.



## [0.23.1] - 2020-12-22
### Changed
 - renamed `Scope.getFiles()` to `Scope.getAllFiles()` and added a new function called `Scope.getOwnFiles()`
### Fixed
 - bug preventing `d.bs` loaded in parent files from showing up in child files. ([#252](https://github.com/rokucommunity/brighterscript/pull/252))



## [0.23.0] - 2020-12-18
### Changed
 - AST parser refactoring ([#244](https://github.com/rokucommunity/brighterscript/pull/244))
   - Make `ElseIf` into an `ElseIfStatement`
   - Removed `ElseIf` token in favor of separate `else` and `if` tokens
   - Refactored statement separators processing and cleaned error messages
   - Improved try-catch parsing
   - Improved label error handling
### Fixed
 - bug causing invalid diagnostics to be thrown on files with multiple dots in their names ([#257](https://github.com/rokucommunity/brighterscript/pull/257))
 - syntax error for [integer type declaration character](https://developer.roku.com/docs/references/brightscript/language/expressions-variables-types.md#type-declaration-characters) ([#254](https://github.com/rokucommunity/brighterscript/pull/254))
 - syntax error for floats with more than 5 decimal places that also have a trailing exponent ([#255](https://github.com/rokucommunity/brighterscript/pull/255))



## [0.22.1] - 2020-12-14
### Fixed
 - small bug introduced by vscode-languageserver causing crashes anytime negative range values are provided.



## [0.22.0] - 2020-11-23
### Added
 - `try/catch` and `throw` syntax support [#218](https://github.com/rokucommunity/brighterscript/issues/218)



## [0.21.0] - 2020-11-19
### Added
 - Catch when local variables and scope functions have the same name as a class. ([#246](https://github.com/rokucommunity/brighterscript/pull/246))
 - Catch when functions use keyword names ([#247](https://github.com/rokucommunity/brighterscript/pull/247))
### Changed
 - many internal changes:
   - remove all the `BrsType` objects leftover from the upstream `brs` project. Things like `ValueKind`, `BrsType`, the `Token.literal` property.
   - rename the brighterscript `BrsType` class to `BscType` for more distinction from the  now deleted from-upstream `BrsType`.
   - Modify the `createToken` function in `astUtils/creators.ts` to accept a range, or use a default negative range.
   - Use the `BscType` objects for basic parser type tracking (this replaces `ValueKind` and `BrsType` from upstream `brs` project).
   - minor AST property changes for `ForStatement` and `FunctionStatement`,
   - any `ValueKind` references in code have been replaced with an instance of a `BscType` (which will be the backbone of future type tracking)
   - Updated `ForStatement` to no longer include synthetic `step 1` tokens when those were not included in the source file.
   - remove eliminated `BrsType` items from `reflection.ts`.


## [0.20.1] - 2020-11-16
### Changed
 - load plugins relatively to the project ([#242](https://github.com/rokucommunity/brighterscript/pull/242))
 - modified reflection utilities so they are compatible with TS strict null checks ([#243](https://github.com/rokucommunity/brighterscript/pull/243))



## [0.20.0] - 2020-11-13
### Added
 - more language server features: onWorkspaceSymbol, onSignatureHelp, onDocumentSymbol, onReferences, improve onDefinition ([#191](https://github.com/rokucommunity/brighterscript/pull/191))



## [0.19.0] - 2020-11-04
### Changed
 - `emitDefinitions` now defaults to `false` (it previously defaulted to `true`)
### Fixed
 - don't transpile `d.bs` files (which would produce `d.brs` files with duplicate information in them)



## [0.18.2] - 2020-11-2
### Fixed
 - support on-demand parse for typedef-shadowed files ([#237](https://github.com/rokucommunity/brighterscript/pull/237))



## [0.18.1] - 2020-10-30
### Fixed
 - exclude bs1100 for typedef files (`Missing "super()" call in class constructor method.`)
 - fix some invalid class field types in typedef files
 - include `override` keyword in class methods in typedef files



## [0.18.0] - 2020-10-30
### Added
 - support for consuming and producing type definitions. ([188](https://github.com/rokucommunity/brighterscript/pull/188))



## [0.17.0] - 2020-10-27
### Added
 - Annotation syntax and AST support ([#234](https://github.com/rokucommunity/brighterscript/pull/234))



## [0.16.12] - 2020-10-21
### Fixed
 - parser bug when there was a trailing colon after `for` or `while` loop statements ([#230](https://github.com/rokucommunity/brighterscript/pull/230))



## [0.16.11] - 2020-10-20
### Fixed
 - bug when using single quotes in an xml script tag
### Changed
 - removed bs1106 (.bs file script tags must use the `type="brighterscript"`) diagnostic because it's unnecessary.



## [0.16.10] - 2020-10-20
### Fixed
 - prevent crash when a callable has the same name as a javascript reserved name ([#226](https://github.com/rokucommunity/brighterscript/pull/226))
 - prevent crash when `import` statement is malformed ([#224](https://github.com/rokucommunity/brighterscript/pull/224))



## [0.16.9] - 2020-10-18
### Fixed
 - reduce language server throttle for validation and parsing now that those have improved performance.
 - massively improve validation performance by refactoring `getFileByPkgPath`
 - micro-optimization of hot parser functions
 - change codebase to use `import type` many places, which reduces the number of files imported at runtime



## [0.16.8] - 2020-10-15
### Fixed
 - bug when printing diagnostics that would crash if the contents were missing (like for in-memory-only files injected by plugins) ([#217](https://github.com/rokucommunity/brighterscript/pull/217))
 - Drop expensive AST walking for collecting property names and instead collect them as part of parsing



## [0.16.7] - 2020-10-13
### Fixed
 - bug when finding `bsconfig.json` that would use the wrong cwd in multi-workspace language server situations.
 - bug when transpiling in-memory-only files. ([#212](https://github.com/rokucommunity/brighterscript/pull/212))



## [0.16.6] - 2020-10-13
### Fixed
 - quirk in the GitHub actions workflow that didn't publish the correct code.



## [0.16.5] - 2020-10-13
### Fixed
 - performance issue during the parse phase. We now defer certain collections until needed. ([#210](https://github.com/rokucommunity/brighterscript/pull/210))



## [0.16.4] - 2020-10-12
### Changed
 - LanguageServer now sends a _diff_ of diagnostics for files, instead of the entire project's diagnostics every time. ([#204](https://github.com/rokucommunity/brighterscript/pull/204))
### Fixed
 - transpile bug for namespaced class constructors that wouldn't properly prepend the namespace in some situations. ([#208](https://github.com/rokucommunity/brighterscript/pull/208))
 - bug in class validation that was causing bogus diagnostics during class construction in namespaces.([#203](https://github.com/rokucommunity/brighterscript/issues/203))



## [0.16.3] - 2020-10-11
### Changed
 - Add generic type parameter for `Program` add functions.
 - Export `BscType` type to simplify `BrsFile | XmlFile` usage everywhere.
### Fixed
 - Prevent bogus diagnostic on all callfunc operations ([#205](https://github.com/rokucommunity/brighterscript/issues/205))



## [0.16.2] - 2020-10-09
### Fixed
 - critical bug in diagnostic printing that would crash the program if a diagnostic was missing a valid range.



## [0.16.1] - 2020-10-03
### Changed
 - rename `isEscapedCharCodeLiteral` to `isEscapedCharCodeLiteralExpression` to match other expression class names
 - rename `FunctionParameter` to `FunctionParameterExpression` to match other expression class names
 - convert `AAMemberExpression` interface into an expression class.
 - convert `isBrsFile` and `isXmlFile` to check for constructor file name rather than file extension.
### Fixed
 - bugs with plugin interoperability with BrighterScript when using `instanceof`. All internal BrighterScript logic now uses the `is` functions from `astutils/reflection`, and plugin authors should do the same.



## [0.16.0] - 2020-10-02
### Added
 - `Expression.walk` and `Statement.walk` functions which provide shallow or deep walking of the AST
 - Many `ast` reflection methods to be used instead of `instanceof`.
 - plugin system (still in alpha) support for re-scanning the AST after modifing the AST by calling `invalidateReferences()`
 - every token has a `leadingWhitespace` property now that contains leading whitespace. Retrieving whitespace tokens from the `Lexer` will be removed in a future update in favor of this appraoch
### Changed
 - all AST nodes now extend either `Statement` or `Expression` instead of simply implementing their interfaces.
### Removed
 - several AST walking functions from `astUtils/` in favor of direct node walking



## [0.15.2] - 2020-10-01
### Fixed
 - Bug in component validation that would throw errors if component name was undefined (generally due to an XML parse error). ([#194](https://github.com/rokucommunity/brighterscript/pull/194))



## [0.15.1] - 2020-09-30
### Fixed
 - improved performance in the lexer and parser
 - potential for accidentally changing `cwd` during bsconfig resolving



## [0.15.0] - 2020-09-18
### Added
 - plugin API to allow visibility into the various compiler phases. This is currently in alpha. ([#170](https://github.com/rokucommunity/brighterscript/pull/170))



## [0.14.0] - 2020-09-04
### Changed
 - Add error diagnostic BS1115 which flags duplicate component names [#186](https://github.com/rokucommunity/brighterscript/pull/186)



## [0.13.2] - 2020-08-31
### Changed
 - Upgraded BS1104 to error (previously a warning) and refined the messaging.



## [0.13.1] - 2020-08-14
### Changed
 - upgraded to [roku-deploy@3.2.3](https://github.com/rokucommunity/roku-deploy/blob/master/CHANGELOG.md#323---2020-08-14)
 - throw exception when copying to staging folder and `rootDir` does not exist in the file system
 - throw exception when zipping package and `${stagingFolder}/manifest` does not exist in the file system



## [0.13.0] - 2020-08-10
### Added
 - ability to mark the `extends` and `project` options in `bsconfig.json`, API and CLI as optional.



## [0.12.4] - 2020-08-06
### Fixed
 - bug in cli that wouldn't properly read bsconfig values. [#167](https://github.com/rokucommunity/brighterscript/issues/167)
 - bug in cli that doesn't use `retain-staging-folder` argument properly. [#168](https://github.com/rokucommunity/brighterscript/issues/168)



## [0.12.3] - 2020-08-03
### Fixed
 - bug in the language server that would provide stale completions due to the file throttling introduced in v0.11.2. Now the language server will wait for the throttled parsing to complete before serving completion results.



## [0.12.2] - 2020-07-16
### Added
 - Expose `ProgramBuilder.transpile()` method to make it easier for tools to transpile programmatically. [#154](https://github.com/rokucommunity/brighterscript/issues/154)
### Fixed
 - bug on Windows when transpiling BrighterScript import statements into xml script tags that would use the wrong path separator sometimes.



## [0.12.1] - 2020-07-15
### Changed
 - upgraded to [roku-deploy@3.2.2](https://github.com/rokucommunity/roku-deploy/blob/master/CHANGELOG.md#322---2020-07-14)
### Fixed
 - bug in roku-deploy when when loading `stagingFolderPath` from `rokudeploy.json` or `bsconfig.json` that would crash the language server



## [0.12.0] - 2020-07-09
### Added
 - `diagnosticLevel` option to limit/control the noise in the console diagnostics
### Changed
 - Move away from `command-line-args` in favor of `yargs` for CLI support
### Fixed
 - Throttle LanguageServer validation to prevent running too many validations in a row.
 - Bug in CLI preventing ability to provide false values to certain flags
 - Do not print `info` and `hint` diagnostics from the CLI by default.



## [0.11.2] - 2020-07-09
### Changed
 - add 350ms debounce in LanguageServer `onDidChangeWatchedFiles` to increase performance by reducing the number of times a file is parsed and validated.
### Fixed
 - bug in the log output that wasn't casting string log levels into their numeric enum versions, causing messages to be lost at certain log levels.
 - load manifest file exactly one time per program rather than every time a file gets parsed.
 - bug in `info` logging that wasn't showing the proper parse times for files on first run.



## [0.11.1] - 2020-07-07
### Added
 - diagnostic for unknown file reference in import statements ([#139](https://github.com/rokucommunity/brighterscript/pull/139))
### Changed
 - upgraded to [roku-deploy@3.2.1](https://www.npmjs.com/package/roku-deploy/v/3.2.1)
 - upgraded to jsonc-parser@2.3.0
 - add begin and end template string literal tokens so we can better format and understand the code downstream. ([#138](https://github.com/rokucommunity/brighterscript/pull/138))
### Fixed
 - roku-deploy bug that would fail to load `bsconfig.json` files with comments in them.
 - bug in parser that would fail to find function calls in certain situations, killing the rest of the parse.



## [0.11.0] - 2020-07-06
### Added
 - [Source literals feature](https://github.com/rokucommunity/brighterscript/blob/master/docs/source-literals.md) which adds new literals such as `SOURCE_FILE_PATH`, `SOURCE_LINE_NUM`, `FUNCTION_NAME`, and more. ([#13](https://github.com/rokucommunity/brighterscript/issues/13))
 - `sourceRoot` config option to fix sourcemap paths for projects that use a temporary staging folder before calling the BrighterScript compiler. ([#134](https://github.com/rokucommunity/brighterscript/commit/e5b73ca37016d5015a389257fb259573c4721e7a))
 - [Template string feature](https://github.com/rokucommunity/brighterscript/blob/master/docs/template-strings.md) which brings template string support to BrighterScript. ([#98](https://github.com/rokucommunity/brighterscript/issues/98))
### Fixed
 - Do not show BS1010 diagnostic `hint`s for the same script imported for parent and child. ([#113](https://github.com/rokucommunity/brighterscript/issues/113))



## [0.10.11] - 2020-07-05
 - Fix bug that would fail to copy files to staging without explicitly specifying `stagingFolderpath`. [#129](https://github.com/rokucommunity/brighterscript/issues/129)



## [0.10.10] - 2020-06-12
### Fixed
 - include the missing `bslib.brs` file in the npm package which was causing errors during transpile.



## [0.10.9] 2020-06-12
### Added
 - bslib.brs gets copied to `pkg:/source` and added as an import to every component on transpile.
 - several timing logs under the `"info"` log level.
### Changed
 - pipe the language server output to the extension's log window
### Fixed
 - bug with global `val` function signature that did not support the second parameter ([#110](https://github.com/rokucommunity/vscode-brightscript-language/issues/110))
 - bug with global 'StrI' function signature that did not support the second parameter.



## [0.10.8] - 2020-06-09
### Fixed
 - Allow leading spcaes for `bs:disable-line` and `bs:disable-next-line` comments ([#108](https://github.com/rokucommunity/brighterscript/pull/108))



## [0.10.7] - 2020-06-08
### Fixed
 - bug in cli that was always returning a nonzero error code



## [0.10.6] - 2020-06-05
### Fixed
 - incorrect definition for global `Left()` function. ([#100](https://github.com/rokucommunity/brighterscript/issues/100))
 - missing definition for global `Tab()` and `Pos()` functions ([#101](https://github.com/rokucommunity/brighterscript/issues/101))



## [0.10.5] - 2020-06-04
### Changed
 - added better logging for certain critical language server crashes



## [0.10.4] - 2020-05-28
### Fixed
 - bug where assigning a namespaced function to a variable wasn't properly transpiling the dots to underscores (fixes [#91](https://github.com/rokucommunity/brighterscript/issues/91))
 - flag parameter with same name as namespace
 - flag variable with same name as namespace
 - `CreateObject("roRegex")` with third parameter caused compile error ([#95](https://github.com/rokucommunity/brighterscript/issues/95))



## [0.10.3] - 2020-05-27
### Changed
 - tokenizing a string with no closing quote will now include all of the text until the end of the line.
 - language server `TranspileFile` command now waits until the program is finished building before trying to transpile.



## [0.10.2] - 2020-05-23
### Added
 - language server command `TranspileFile` which will return the transpiled contents of the requested file.
### Fixed
 - quotemarks in string literals were not being properly escaped during transpile ([#89](https://github.com/rokucommunity/brighterscript/issues/89))
 - Bug that was only validating calls at top level. Now calls found anywhere in a function are validated



## [0.10.1] - 2020-05-22
### Fixed
 - transpile bug for compound assignment statements (such as `+=`, `-=`) ([#87](https://github.com/rokucommunity/brighterscript/issues/87))
 - transpile bug that was inserting function parameter types before default values ([#88](https://github.com/rokucommunity/brighterscript/issues/88))
 - export BsConfig interface from index.ts to make it easier for NodeJS importing.



## [0.10.0] - 2020-05-19
### Added
 - new callfunc operator.



## [0.9.8] - 2020-05-16
### Changed
 - the inner event system handling file changes. This should fix several race conditions causing false negatives during CLI runs.
### Fixed
 - some bugs related to import statements not being properly traced.



## [0.9.7] - 2020-05-14
### Changed
 - TypeScript target to "ES2017" which provides a significant performance boost in lexer (~30%) and parser (~175%)
### Fixed
 - the binary name got accidentally renamed to `bsc2` in release 0.9.6. This release fixes that issue.
 - removed some debug logs that were showing up when not using logLevel=debug
 - false negative diagnostic when using the `new` keyword as a local variable [#79](https://github.com/rokucommunity/brighterscript/issues/79)



## [0.9.6] - 2020-05-11
### Added
 - `logLevel` option from the bsconfig.json and command prompt that allows specifying how much detain the logging should contain.
 - additional messages during cli run
### Changed
 - don't terminate bsc on warning diagnostics
 - removed extraneous log statements from the util module
### Fixed
 - fixed bugs when printing diagnostics to the console that wouldn't show the proper squiggly line location.



## [0.9.5] - 2020-05-06
### Added
 - new config option called `showDiagnosticsInConsole` which disables printing diagnostics to the console
### Fixed
 - bug in lexer that was capturing the carriage return character (`\n`) at the end of comment statements
 - bug in transpiler that wouldn't include a newline after the final comment statement
 - bug in LanguageServer that was printing diagnostics to the console when it shouldn't be.



## [0.9.4] - 2020-05-05
### Added
 - diagnostic for detecting unnecessary script imports when `autoImportComponentScript` is enabled
### Changed
 - filter duplicate dignostics from multiple projects. ([#75](https://github.com/rokucommunity/brighterscript/issues/75))
### Fixed
 - bug that was flagging namespaced functions with the same name as a stdlib function.
 - bug that was not properly transpiling brighterscript script tags in xml components.
 - several performance issues introduced in v0.8.2.
 - Replace `type="text/brighterscript"` with `type="text/brightscript"` in xml script imports during transpile. ([#73](https://github.com/rokucommunity/brighterscript/issues/73))



## [0.9.3] - 2020-05-04
### Changed
 - do not show BRS1013 for standalone files ([#72](https://github.com/rokucommunity/brighterscript/issues/72))
 - BS1011 (same name as global function) is no longer shown for local variables that are not of type `function` ([#70](https://github.com/rokucommunity/brighterscript/issues/70))
### Fixed
 - issue that prevented certain keywords from being used as function parameter names ([#69](https://github.com/rokucommunity/brighterscript/issues/69))



## [0.9.2] - 2020-05-02
### Changed
 - intellisense anywhere other than next to a dot now includes keywords (#67)

### Fixed
 - bug in the lexer that was not treating `constructor` as an identifier (#66)
 - bug when printing diagnostics that would sometimes fail to find the line in question (#68)
 - bug in scopes that were setting isValidated=false at the end of the `validate()` call instead of true



## [0.9.1] - 2020-05-01
### Fixed
 - bug with upper-case two-word conditional compile tokens (`#ELSE IF` and `#END IF`) (#63)



## [0.9.0] - 2020-05-01
### Added
 - new compile flag `autoImportComponentScript` which will automatically import a script for a component with the same name if it exists.



## [0.8.2] - 2020-04-29
### Fixed
 - bugs in namespace transpilation
 - bugs in class transpilation
 - transpiled examples for namespace and class docs
 - bugs in class property initialization



## [0.8.1] - 2020-04-27
### Fixed
 - Bug where class property initializers would cause parse error
 - better parse recovery for incomplete class members



## [0.8.0] - 2020-04-26
### Added
 - new `import` syntax for BrighterScript projects.
 - experimental transpile support for xml files (converts `.bs` extensions to `.brs`, auto-appends the `import` statments to each xml component)
### Changed
 - upgraded to vscode-languageserver@6.1.1


## [0.7.2] - 2020-04-24
### Fixed
 - runtime bug in the language server when validating incomplete class statements



## [0.7.1] - 2020-04-23
### Fixed
 - dependency issue: `glob` is required but was not listed as a dependency



## [0.7.0] - 2020-04-23
### Added
 - basic support for namespaces
 - experimental parser support for import statements (no transpile yet)
### Changed
 - parser produces TokenKind.Library now instead of an identifier token for library.



## [0.6.0] 2020-04-15
### Added
 - ability to filter out diagnostics by using the `diagnosticFilters` option in bsconfig
### Changed
 - deprecated the `ignoreErrorCodes` in favor of `diagnosticFilters`
### Fixed
 - Bug in the language server that wasn't reloading the project when changing the `bsconfig.json`



## [0.5.4] 2020-04-13
### Fixed
 - Syntax bug that wasn't allowing period before indexed get expression (example: `prop.["key"]`) (#58)
 - Syntax bug preventing comments from being used in various locations within a class



## [0.5.3] - 2020-04-12
### Added
 - syntax support for the xml attribute operator (`node@someAttr`) (#34)
 - syntax support for bitshift operators (`<<` and `>>`) (#50)
 - several extra validation checks for class statements
### Fixed
 - syntax bug that was showing parse errors for known global method names (such as `string()`) (#49)



## [0.5.2] - 2020-04-11
### Changed
 - downgrade diagnostic issue 1007 from an error to a warning, and updated the message to "Component is mising "extends" attribute and will automatically extend "Group" by default" (#53)
### Fixed
 - Prevent xml files found outside of the `pkg:/components` folder from being parsed and validated. (#51)
 - allow empty `elseif` and `else` blocks. (#48)



## [0.5.1] - 2020-04-10
### Changed
 - upgraded to [roku-deploy@3.0.2](https://www.npmjs.com/package/roku-debug/v/0.3.4) which fixed a file copy bug in subdirectories of symlinked folders (fixes #41)



## [0.5.0] - 2020-04-10
### Added
 - several new diagnostics for conditional compiles. Some of them allow the parser to recover and continue.
 - experimental class transpile support. There is still no intellisense for classes yet though.
### Changed
   - All errors are now stored as vscode-languageserver `Diagnostic` objects instead of a custom error structure.
   - Token, AST node, and diagnostic locations are now stored as `Range` objects, which use zero-based lines instead of the previous one-based line numbers.
   - All parser diagnostics have been broken out into their own error codes, removing the use of error code 1000 for a generic catch-all. That code still exists and will hold runtime errors from the parser.
### Fixed
 - bug in parser that was flagging the new class keywords (`new`, `class`, `public`, `protected`, `private`, `override`) as parse errors. These are now allowed as both local variables and property names.



## [0.4.4] - 2020-04-04
### Fixed
 - bug in the ProgramBuilder that would terminate the program on first run if an error diagnostic was found, even when in watch mode.



## [0.4.3] - 2020-04-03
### Changed
 - the `bsc` cli now emits a nonzero return code whenever parse errors are encountered, which allows tools to detect compile-time errors. (#43)



## [0.4.2] - 2020-04-01
### Changed
 - upgraded to [roku-deploy@3.0.0](https://www.npmjs.com/package/roku-deploy/v/3.0.0)



## [0.4.1] - 2020-01-11
### Changed
 - upgraded to [roku-deploy@3.0.0-beta.7](https://www.npmjs.com/package/roku-deploy/v/3.0.0-beta.7) which fixed a critical bug during pkg creation.



## [0.4.0] - 2020-01-07
### Added
 - ability to specify the pkgPath of a file when adding to the project.
### Changed
 - upgraded to [roku-deploy@3.0.0-beta.6](https://www.npmjs.com/package/roku-deploy/v/3.0.0-beta.6)
### Fixed
 - bug that was showing duplicate function warnings when multiple files target the same `pkgPath`. Now roku-deploy will only keep the last referenced file for each `pkgPath`
 - reduced memory consumtion and FS calls during file watcher events
 - issue in getFileByPkgPath related to path separator mismatches
 - bugs related to standalone workspaces causing issues for other workspaces.



## [0.3.1] - 2019-11-08
### Fixed
 - language server bug that was showing error messages in certain startup race conditions.
 - error during hover caused by race condition during file re-parse.



## [0.3.0] - 2019-10-03
### Added
 - support for parsing opened files not included in any project.
### Fixed
 - parser bug that was preventing comments as their own lines inside associative array literals. ([#29](https://github.com/rokucommunity/brighterscript/issues/28))



## [0.2.2] - 2019-09-27
### Fixed
 - bug in language server where the server would crash when sending a diagnostic too early. Now the server waits for the program to load before sending diagnostics.



## [0.2.1] - 2019-09-24
### Changed
 - the text for diagnostic 1010 to say "override" instead of "shadows"
### Fixed
 - crash when parsing the workspace path to read the config on startup.
 - auto complete options not always returning results when it should.
 - windows bug relating to the drive letter being different, and so then not matching the file list.
 - many bugs related to mismatched file path comparisons.



## [0.2.0] - 2019-09-20
### Added
 - bsconfig.json validation
 - slightly smarter intellisense that knows when you're trying to complete an object property.
 - diagnostic for deprecated brsconfig.json
 - basic transpile support including sourcemaps. Most lines also support transpiling including comments, but there may still be bugs
 - parser now includes all comments as tokens in the AST.

### Fixed
 - bugs in the languageserver intellisense
 - parser bug that would fail when a line ended with a period
 - prevent intellisense when typing inside a comment
 - Bug during file creation that wouldn't recognize the file


## [0.1.0] - 2019-08-10
### Changed
 - Cloned from [brightscript-language](https://github.com/rokucommunity/brightscript-language)


[0.1.0]:    https://github.com/rokucommunity/brighterscript/compare/v0.1.0...v0.1.0
[0.2.0]:    https://github.com/rokucommunity/brighterscript/compare/v0.1.0...v0.2.0
[0.2.1]:    https://github.com/rokucommunity/brighterscript/compare/v0.2.0...v0.2.1
[0.2.2]:    https://github.com/rokucommunity/brighterscript/compare/v0.2.1...v0.2.2
[0.3.0]:    https://github.com/rokucommunity/brighterscript/compare/v0.2.2...v0.3.0
[0.3.1]:    https://github.com/rokucommunity/brighterscript/compare/v0.3.0...v0.3.1
[0.4.0]:    https://github.com/rokucommunity/brighterscript/compare/v0.3.1...v0.4.0
[0.4.1]:    https://github.com/rokucommunity/brighterscript/compare/v0.4.0...v0.4.1
[0.4.2]:    https://github.com/rokucommunity/brighterscript/compare/v0.4.1...v0.4.2
[0.4.3]:    https://github.com/rokucommunity/brighterscript/compare/v0.4.2...v0.4.3
[0.4.4]:    https://github.com/rokucommunity/brighterscript/compare/v0.4.3...v0.4.4
[0.5.0]:    https://github.com/rokucommunity/brighterscript/compare/v0.4.4...v0.5.0
[0.5.1]:    https://github.com/rokucommunity/brighterscript/compare/v0.5.0...v0.5.1
[0.5.2]:    https://github.com/rokucommunity/brighterscript/compare/v0.5.1...v0.5.2
[0.5.3]:    https://github.com/rokucommunity/brighterscript/compare/v0.5.2...v0.5.3
[0.5.4]:    https://github.com/rokucommunity/brighterscript/compare/v0.5.3...v0.5.4
[0.6.0]:    https://github.com/rokucommunity/brighterscript/compare/v0.5.4...v0.6.0
[0.7.0]:    https://github.com/rokucommunity/brighterscript/compare/v0.6.0...v0.7.0
[0.7.1]:    https://github.com/rokucommunity/brighterscript/compare/v0.7.0...v0.7.1
[0.7.2]:    https://github.com/rokucommunity/brighterscript/compare/v0.7.1...v0.7.2
[0.8.0]:    https://github.com/rokucommunity/brighterscript/compare/v0.7.2...v0.8.0
[0.8.1]:    https://github.com/rokucommunity/brighterscript/compare/v0.8.0...v0.8.1
[0.8.2]:    https://github.com/rokucommunity/brighterscript/compare/v0.8.1...v0.8.2
[0.9.0]:    https://github.com/rokucommunity/brighterscript/compare/v0.8.2...v0.9.0
[0.9.1]:    https://github.com/rokucommunity/brighterscript/compare/v0.9.0...v0.9.1
[0.9.2]:    https://github.com/rokucommunity/brighterscript/compare/v0.9.1...v0.9.2
[0.9.3]:    https://github.com/rokucommunity/brighterscript/compare/v0.9.2...v0.9.3
[0.9.4]:    https://github.com/rokucommunity/brighterscript/compare/v0.9.3...v0.9.4
[0.9.5]:    https://github.com/rokucommunity/brighterscript/compare/v0.9.4...v0.9.5
[0.9.6]:    https://github.com/rokucommunity/brighterscript/compare/v0.9.5...v0.9.6
[0.9.7]:    https://github.com/rokucommunity/brighterscript/compare/v0.9.6...v0.9.7
[0.9.8]:    https://github.com/rokucommunity/brighterscript/compare/v0.9.7...v0.9.8
[0.10.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.9.8...v0.10.0
[0.10.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.10.0...v0.10.1
[0.10.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.10.1...v0.10.2
[0.10.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.10.2...v0.10.3
[0.10.4]:   https://github.com/rokucommunity/brighterscript/compare/v0.10.3...v0.10.4
[0.10.5]:   https://github.com/rokucommunity/brighterscript/compare/v0.10.4...v0.10.5
[0.10.6]:   https://github.com/rokucommunity/brighterscript/compare/v0.10.5...v0.10.6
[0.10.7]:   https://github.com/rokucommunity/brighterscript/compare/v0.10.6...v0.10.7
[0.10.8]:   https://github.com/rokucommunity/brighterscript/compare/v0.10.7...v0.10.8
[0.10.9]:   https://github.com/rokucommunity/brighterscript/compare/v0.10.8...v0.10.9
[0.10.10]:  https://github.com/rokucommunity/brighterscript/compare/v0.10.9...v0.10.10
[0.11.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.10.10...v0.11.0
[0.11.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.11.0...v0.11.1
[0.11.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.11.1...v0.11.2
[0.11.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.11.2...v0.11.3
[0.12.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.11.3...v0.12.0
[0.12.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.12.0...v0.12.1
[0.12.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.12.1...v0.12.2
[0.12.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.12.2...v0.12.3
[0.12.4]:   https://github.com/rokucommunity/brighterscript/compare/v0.12.3...v0.12.4
[0.13.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.12.4...v0.13.0
[0.13.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.13.0...v0.13.1
[0.13.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.13.1...v0.13.2
[0.14.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.13.2...v0.14.0
[0.15.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.14.0...v0.15.0
[0.15.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.15.0...v0.15.1
[0.15.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.15.1...v0.15.2
[0.16.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.15.2...v0.16.0
[0.16.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.16.0...v0.16.1
[0.16.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.16.1...v0.16.2
[0.16.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.16.2...v0.16.3
[0.16.4]:   https://github.com/rokucommunity/brighterscript/compare/v0.16.3...v0.16.4
[0.16.5]:   https://github.com/rokucommunity/brighterscript/compare/v0.16.4...v0.16.5
[0.16.6]:   https://github.com/rokucommunity/brighterscript/compare/v0.16.5...v0.16.6
[0.16.7]:   https://github.com/rokucommunity/brighterscript/compare/v0.16.6...v0.16.7
[0.16.8]:   https://github.com/rokucommunity/brighterscript/compare/v0.16.7...v0.16.8
[0.16.9]:   https://github.com/rokucommunity/brighterscript/compare/v0.16.8...v0.16.9
[0.16.10]:  https://github.com/rokucommunity/brighterscript/compare/v0.16.9...v0.16.10
[0.16.11]:  https://github.com/rokucommunity/brighterscript/compare/v0.16.10...v0.16.11
[0.16.12]:  https://github.com/rokucommunity/brighterscript/compare/v0.16.11...v0.16.12
[0.17.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.16.12...v0.17.0
[0.18.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.17.0...v0.18.0
[0.18.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.18.0...v0.18.1
[0.18.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.18.1...v0.18.2
[0.19.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.18.2...v0.19.0
[0.20.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.19.0...v0.20.0
[0.20.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.20.0...v0.20.1
[0.21.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.20.1...v0.21.0
[0.22.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.21.0...v0.22.0
[0.22.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.22.0...v0.22.1
[0.22.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.22.0...v0.22.1
[0.23.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.22.1...v0.23.0
[0.23.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.23.0...v0.23.1
[0.23.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.23.1...v0.23.2
[0.24.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.23.2...v0.24.0
[0.24.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.24.0...v0.24.1
[0.24.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.24.1...v0.24.2
[0.25.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.24.2...v0.25.0
[0.26.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.25.0...v0.26.0
[0.27.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.26.0...v0.27.0
[0.28.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.27.0...v0.28.0
[0.28.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.28.0...v0.28.1
[0.28.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.28.1...v0.28.2
[0.29.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.28.2...v0.29.0
[0.30.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.29.0...v0.30.0
[0.30.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.30.0...v0.30.1
[0.30.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.30.1...v0.30.2
[0.30.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.30.2...v0.30.3
[0.30.4]:   https://github.com/rokucommunity/brighterscript/compare/v0.30.3...v0.30.4
[0.30.5]:   https://github.com/rokucommunity/brighterscript/compare/v0.30.4...v0.30.5
[0.30.6]:   https://github.com/rokucommunity/brighterscript/compare/v0.30.5...v0.30.6
[0.30.7]:   https://github.com/rokucommunity/brighterscript/compare/v0.30.6...v0.30.7
[0.30.8]:   https://github.com/rokucommunity/brighterscript/compare/v0.30.7...v0.30.8
[0.30.9]:   https://github.com/rokucommunity/brighterscript/compare/v0.30.8...v0.30.9
[0.31.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.30.9...v0.31.0
[0.31.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.31.0...v0.31.1
[0.31.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.31.1...v0.31.2
[0.32.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.31.2...v0.32.2
[0.32.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.32.2...v0.32.3
[0.33.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.32.3...v0.33.0
[0.34.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.33.0...v0.34.0
[0.34.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.34.0...v0.34.1
[0.34.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.34.1...v0.34.2
[0.34.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.34.2...v0.34.3
[0.35.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.34.3...v0.35.0
[0.36.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.35.0...v0.36.0
[0.37.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.36.0...v0.37.0
[0.37.1]:   https://github.com/rokucommunity/brighterscript/compare/v0.37.0...v0.37.1
[0.37.2]:   https://github.com/rokucommunity/brighterscript/compare/v0.37.1...v0.37.2
[0.37.3]:   https://github.com/rokucommunity/brighterscript/compare/v0.37.2...v0.37.3
[0.37.4]:   https://github.com/rokucommunity/brighterscript/compare/v0.37.3...v0.37.4
[0.38.0]:   https://github.com/rokucommunity/brighterscript/compare/v0.37.4...v0.38.0
