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
