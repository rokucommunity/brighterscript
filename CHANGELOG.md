# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



## 0.9.2 - 2020-05-02
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
 - depricated the `ignoreErrorCodes` in favor of `diagnosticFilters`
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
 - diagnostic for depricated brsconfig.json
 - basic transpile support including sourcemaps. Most lines also support transpiling including comments, but there may still be bugs
 - parser now includes all comments as tokens in the AST.

### Fixed
 - bugs in the languageserver intellisense
 - parser bug that would fail when a line ended with a period
 - prevent intellisense when typing inside a comment
 - Bug during file creation that wouldn't recognize the file


## 0.1.0 - 2019-08-10
### Changed
 - Cloned from [brightscript-language](https://github.com/rokucommunity/brightscript-language)



[0.9.2]:  https://github.com/rokucommunity/brighterscript/compare/v0.9.1...v0.9.2
[0.9.1]:  https://github.com/rokucommunity/brighterscript/compare/v0.9.0...v0.9.1
[0.9.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.8.2...v0.9.0
[0.8.2]:  https://github.com/rokucommunity/brighterscript/compare/v0.8.1...v0.8.2
[0.8.1]:  https://github.com/rokucommunity/brighterscript/compare/v0.8.0...v0.8.1
[0.8.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.7.2...v0.8.0
[0.7.2]:  https://github.com/rokucommunity/brighterscript/compare/v0.7.1...v0.7.2
[0.7.1]:  https://github.com/rokucommunity/brighterscript/compare/v0.7.0...v0.7.1
[0.7.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.6.0...v0.7.0
[0.6.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.5.4...v0.6.0
[0.5.4]:  https://github.com/rokucommunity/brighterscript/compare/v0.5.3...v0.5.4
[0.5.3]:  https://github.com/rokucommunity/brighterscript/compare/v0.5.2...v0.5.3
[0.5.2]:  https://github.com/rokucommunity/brighterscript/compare/v0.5.1...v0.5.2
[0.5.1]:  https://github.com/rokucommunity/brighterscript/compare/v0.5.0...v0.5.1
[0.5.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.4.4...v0.5.0
[0.4.4]:  https://github.com/rokucommunity/brighterscript/compare/v0.4.3...v0.4.4
[0.4.3]:  https://github.com/rokucommunity/brighterscript/compare/v0.4.2...v0.4.3
[0.4.2]:  https://github.com/rokucommunity/brighterscript/compare/v0.4.1...v0.4.2
[0.4.1]:  https://github.com/rokucommunity/brighterscript/compare/v0.4.0...v0.4.1
[0.4.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.3.1...v0.4.0
[0.3.1]:  https://github.com/rokucommunity/brighterscript/compare/v0.3.0...v0.3.1
[0.3.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.2.2...v0.3.0
[0.2.2]:  https://github.com/rokucommunity/brighterscript/compare/v0.2.1...v0.2.2
[0.2.1]:  https://github.com/rokucommunity/brighterscript/compare/v0.2.0...v0.2.1
[0.2.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.1.0...v0.2.0
[0.1.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.1.0...v0.1.0
