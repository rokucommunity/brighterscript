# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



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
 - Cloned from [brightscript-language](https://github.com/twitchbronbron/brightscript-language)



[0.3.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.2.2...v0.3.0
[0.2.2]:  https://github.com/rokucommunity/brighterscript/compare/v0.2.1...v0.2.2
[0.2.1]:  https://github.com/rokucommunity/brighterscript/compare/v0.2.0...v0.2.1
[0.2.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.1.0...v0.2.0
[0.1.0]:  https://github.com/rokucommunity/brighterscript/compare/v0.1.0...v0.1.0
