# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.2.15] - 2019-08-10
### Fixed
 - bug in LanguageServer hover request that was not sending the proper structure for supporting language colorization.



## [0.2.14] - 2019-06-13
### Changed
 - upgrade to roku-deploy@2.2.1 which fixes manifest parsing bug related to colors starting with `#`.



## [0.2.13] - 2019-06-13
### Fixed
 - upgraded to brs@0.14.0-nightly.20190613 which brings the following changes: 
   - syntax support for `GOTO` and labels [brs#248](https://github.com/sjbarag/brs/pull/248)



## [0.2.12] - 2019-05-31
### Fixed
 - prevent compile errors for conditional compile statements
 - upgraded to brs@0.13.0-nightly.20190530 which brings the following changes:
   - syntax support for single-word `#elseif` and `#endif` [brs#249](https://github.com/sjbarag/brs/pull/249)
   - syntax support for `stop` statements [brs#247](https://github.com/sjbarag/brs/pull/247)
   - syntax support for empty `print` statements [brs#264](https://github.com/sjbarag/brs/pull/246)



## [0.2.11] - 2019-05-28
### Fixed
 - upgraded to brs@0.13.0 which brings the following changes: 
   - syntax support for `LINE_NUM` variable [brs#242](https://github.com/sjbarag/brs/pull/242)



## [0.2.10] - 2019-05-22
### Fixed
 - upgraded to brs@0.13.0-nightly.2019.05.23 which brings the following changes:
   - syntax support for trailing colons in if statements



## [0.2.9] - 2019-05-22
### Fixed
 - upgraded to brs@0.13.0-nightly.20190522 which brings the following changes
   - syntax support for numbers with leading or trailing period
   - added `&` as supported type designator for identifiers



## [0.2.8] - 2019-05-13
### Changed
 - Export `XmlContext` and `Util` in `index.js`

### Fixed
 - upgraded to brs@0.13.0-nightly.20190514 which fixes broken syntax for library import statements
 


## [0.2.7] - 2019-05-07
### Changed
 - Upgraded to brs@0.13.0-nightly.20190507 which fixes
   - many syntax errors related to using keywords as property names.
   - support for hex literals



## [0.2.6] - 2019-5-01
### Changed 
 - upgraded to brs@0.13.0-nightly.20190501 which removes error for subs with return types ([brs#220](https://github.com/sjbarag/brs/issues/220))



## [0.2.5] - 2019-04-30
### Changed 
 - upgraded to brs@0.13.0-nightly.20190430 which brings support for increment (++) and decrement (--) operators  ([brs#190](https://github.com/sjbarag/brs/issues/190)).



## [0.2.4] - 2019-03-25
### Changed
 - upgraded to brs@0.13.0-nightly.20190325
### Fixed
 - greatly improved single-line recovery. Previously, certain syntax errors would prevent the rest of the block or file from parsing. The parser will now skip erraneous lines and attempt to recover. This _usually_ provides much better error recovery, but in certain cases can produce additional errors in the file. 
 - bitshift assignment operators (`>>=` `<<=`) no longer cause parse errors
 - using colons as separators for associate arrays no longer cause parse errors (e.g `obj = {x:0 : y: 1}`)



## [0.2.3] - 2019-03-20
### Changed
 - upgraded to brs@0.13.0-nightly.20190321
### Fixed
 - better recovery for mismatched `end function` and `end sub` endings.



## [0.2.2] - 2019-03-20
### Fixed
 - targeted EXACTLY brs@0.13.0-nightly.20190320 to prevent npm from resolving 0.13.0-rc.3. Added unit test to prevent this issue from happening again in the future. 



## [0.2.1] - 2019-03-20
### Changed
 - upgraded to brs@0.13.0-nightly.20190320
 - exclude method completions from xml files
 - empty script reference errors will show a more usefull error message `"Script import cannot be empty or whitespace"`
### Fixed
 - parse errors for type designators (i.e. `$` `%` `!` `#` at end of variable name)
 - parse errors for multiple spaces between two-word keywords (`else     if`, etc)



## [0.2.0] - 2019-03-15
### Added
 - very basic `go to definition` support for an xml component. Currently only supports finding a component's parent component.



## [0.1.23] - 2019-03-14
### Fixed
 - `command-line-usage` and `command-line-args` were both moved to dependencies so the cli will work. v0.1.22 did the wrong thing, this fixes it.



## [0.1.22] - 2019-03-14
### Changed
 - completion provider now provides all in-scope variables instead of variables only at or above the cursor
### Fixed
 - moved `command-line-args` from devDependencies to dependencies so that the cli is runnable when installed.



## [0.1.21] - 2019-03-12
### Added
 - the ability to supress warnings and errors on a per-line basis with `brs:disable-next-line` and `brs:disable-line`. 



## [0.1.20] - 2019-03-11
### Fixed
 - targeted EXACTLY brs@0.13.0-nightly.20190310 to fix a weird npm dependency issue that is resolving to 0.13.0-rc.3 for some reason.



## [0.1.19] - 2019-03-10
### Fixed
 - upgraded to brs@0.13.0-nightly.20190310 to fix RHS boolean assignment parse errors (see [this issue](https://github.com/sjbarag/brs/issues/156))
 - LanguageServer
   - hover bug in multi-root workspace that was only showing hovers for the first workspace
   - support loading brsconfig.json path as a setting from a connected languageclient (i.e. vscode)
   - reload workspace if brsconfig.json has changed



## [0.1.18] - 2019-03-08
### Fixed
 - issue where only top-level variables were being found. Now all variables are found throughout the entire function scope.  
 - runtime error when getting hover result.
 - issue with hover that would not find top-level function parameter types.


## [0.1.17] - 2019-03-08
### Fixed
 - Upgraded to brs@0.13.0-nightly.20190307 which fixed assignment operator parse errors. ([see this issue](https://github.com/sjbarag/brs/issues/173)).



## [0.1.16] - 2019-03-06
### Fixed
 - upgraded to brs@0.13.0-nightly.20190306 which fixed the mixed-case `Then` regression ([see this issue](https://github.com/sjbarag/brs/issues/187)).



## [0.1.15] - 2019-03-04
### Fixed
 - issue where `EventEmitter`s were capped at 10 listeners. They no longer have an upper limit (hopefully there isn't a memory leak...)



## [0.1.14] - 2019-03-02
### Changed
 - updated to latest `brs` version that:
    - allows `then` to be used as object property names
    - allows `function` to be used as a parameter type



## [0.1.13] - 2019-02-25
### Fixed
 - issue that was showing duplicate errors when file was included in multiple components ([#10](https://github.com/TwitchBronBron/brightscript-language/issues/10))

### Misc
 - accidentally called this release 0.1.13, when it was intended to be 0.1.3. 



## [0.1.2] - 2019-02-25
### Changed
 - updated installation instructions. 
 - reduced npm package install size (removed test files from `dist` folder)



## 0.1.1 - 2019-02-25
initial project release. 



[0.2.15]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.14...v0.2.15
[0.2.14]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.13...v0.2.14
[0.2.13]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.12...v0.2.13
[0.2.12]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.11...v0.2.12
[0.2.11]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.10...v0.2.11
[0.2.10]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.9...v0.2.10
[0.2.9]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.8...v0.2.9
[0.2.8]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.7...v0.2.8
[0.2.7]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.6...v0.2.7
[0.2.6]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.5...v0.2.6
[0.2.5]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.4...v0.2.5
[0.2.4]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.3...v0.2.4
[0.2.3]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.2...v0.2.3
[0.2.2]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.1...v0.2.2
[0.2.1]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.2.0...v0.2.1
[0.2.0]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.23...v0.2.0
[0.1.23]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.22...v0.1.23
[0.1.22]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.21...v0.1.22
[0.1.21]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.2...v0.1.13
[0.1.2]:  https://github.com/TwitchBronBron/brightscript-language/compare/v0.1.1...v0.1.2