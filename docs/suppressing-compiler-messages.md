# Suppressing compiler messages

The BrighterScript compiler emits errors and warnings when it encounters potentially invalid code. Errors and warnings may also be emitted by compiler plugins, such as by [the BrighterScript linter](https://github.com/rokucommunity/bslint).

Developers may want to suppress some of these messages. There are two ways to do so.

## Modifying compiler diagnostics using bsconfig.json

There are three `bsconfig.json` settings which modify the reporting of compiler messages: `diagnosticFilters`, `diagnosticLevel`, and `diagnosticSeverityOverride`.

[diagnosticFilters](https://github.com/rokucommunity/BrighterScript/blob/master/docs/bsconfig.md#diagnosticFilters) allows users to ignore specific errors and specific file paths. It is useful for targetted suppression of errors.

[diagnosticLevel](https://github.com/rokucommunity/BrighterScript/blob/master/docs/bsconfig.md#diagnosticLevel) allows users to toggle the level of diagnostics which they wish to see. For example, it allows one to hide all warnings and only show errors.

[diagnosticSeverityOverride](https://github.com/rokucommunity/BrighterScript/blob/master/docs/bsconfig.md#diagnosticSeverityOverride) allows users to manually change the severity of a diagnostic, such as setting a particular kind of error to instead by reported as a warning or vice versa. This works in conjunction with the other two options.

## Ignoring errors and warnings on a per-line basis

In addition to modifying errors using `bsconfig.json`, you may also disable errors for a subset of the complier rules within a file with the following comment flags:
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
    DoSomething(1,2,3) 'bs:disable-line

    DoSomething(1,2,3) 'bs:disable-line:1002
end sub

sub DoSomething()
end sub
```

The primary motivation for this feature was to provide a stopgap measure to hide incorrectly-thrown errors on legitimate BrightScript code due to parser bugs. It is recommended that you only use these comments when absolutely necessary.

## Ignoring errors and warnings for an entire file

To suppress diagnostics across an entire file, place a `bs:disable-file` comment in the file's header. The directive only takes effect when it appears before any executable code (comment-only lines and blank lines above it are fine). For XML files, place the comment between the `<?xml ?>` declaration and the root component element.

 - `bs:disable-file`
 - `bs:disable-file: code1 code2 code3`

```BrightScript
' bs:disable-file: 1001 1002

sub Main()
    DoSomething()
end sub
```

```xml
<?xml version="1.0" encoding="utf-8" ?>
<!-- bs:disable-file: 1006 -->
<component name="Foo">
</component>
```

A `bs:disable-file` comment placed below the first line of code (or below the root XML element) is ignored.

## Quick fixes

The BrighterScript language server offers two quick-fix actions on every diagnostic so you can suppress the message without leaving your editor:

 - **Disable {code} for this line: {message}** &mdash; if a `bs:disable-line` or `bs:disable-next-line` directive already exists on/above the diagnostic line, the code is appended to it. Otherwise a new `bs:disable-next-line: {code}` comment is inserted above the diagnostic.
 - **Disable {code} for this file: {message}** &mdash; if a `bs:disable-file` directive already exists in the file's header, the code is appended to it. Otherwise a new `bs:disable-file: {code}` comment is inserted at the top of the file.

These actions appear after the standard quick fixes for a diagnostic.
