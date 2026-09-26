# Select Case Statement
The `select case` statement runs one block of code out of several, based on the value of an expression. It's BrighterScript's version of a `switch` statement. The syntax borrows from Visual Basic, since BrightScript itself is heavily based on VB.

A `select case` always transpiles to a plain `if`/`else if`/`else` chain, so it works on every Roku device.

## Basic usage
```brighterscript
sub describe(numericValue)
    select case numericValue
        case 1
            print "one"
        case 6, 7, 8
            print "between 6 and 8, inclusive"
        case else
            print "no matching case"
    end select
end sub
```

transpiles to:

```brightscript
sub describe(numericValue)
    if numericValue = 1 then
        print "one"
    else if numericValue = 6 or numericValue = 7 or numericValue = 8 then
        print "between 6 and 8, inclusive"
    else
        print "no matching case"
    end if
end sub
```

The cases are checked from top to bottom, and only the **first** matching case runs. If nothing matches, the `case else` branch runs. If there's no `case else`, nothing runs.

## Syntax
```
select [case] testExpression
    [case valueList
        [statements]]
    [case else
        [elseStatements]]
end select
```

- `testExpression` (the "subject") is any expression: a variable, a literal, a function call, `m.top.someField`, and so on.
- `valueList` is one or more comma-separated expressions. The case matches if the subject equals **any** of them.
- `case else` is optional. It must come last, and there can only be one.
- `end select` can also be written as `endselect`. Like the rest of BrightScript, the keywords are case-insensitive (`Select Case`, `End Select`, and so on).

## No fallthrough
If you're coming from C, Java, or JavaScript, this is the big difference: **cases never fall through**, and you don't need a `break` statement. Once a case body finishes, execution continues after `end select`. (To leave a case early, use [`exit select`](#exit-select).)

To run the same code for several values, list them together in one case:

```brighterscript
select case key
    case "left", "right"
        m.moveHorizontally(key)
    case "up", "down"
        m.moveVertically(key)
end select
```

An empty case doesn't run the next case's body. It just does nothing. Since that's almost always a mistake, BrighterScript flags it:

```brighterscript
select case key
    case "left"   ' warning: empty case does nothing (it does NOT fall through to "right")
    case "right"
        m.moveHorizontally(key)
    case else
end select
```

If you really do want a case that does nothing, put a comment or an `exit select` in it. Either one tells the compiler it's on purpose:

```brighterscript
select case key
    case "back"
        ' handled by the parent screen
    case "options"
        exit select
    case "OK"
        m.select()
    case else
end select
```

In the [single-line form](#single-line-form), a comment would hide the rest of the line, so use `exit select`:

```brighterscript
select case key : case "back" : exit select : case "OK" : m.select() : end select
```

## Values on multiple lines
Long value lists can be split across lines. Each line except the last must end with a comma:

```brighterscript
select case errorCode
    case 401,
        403,
        407
        showLoginScreen()
    case else
        showGenericError()
end select
```

The values can also start on the line after `case`:

```brighterscript
select case errorCode
    case
        401, 403, 407
        showLoginScreen()
    case else
        showGenericError()
end select
```

The next line is only treated as the value list when the entire line is a comma-separated list of expressions. If it's anything else (like `print "x"`, another `case`, or `end select`), you'll get an error that the `case` has no value. Keep in mind that a function call or a comparison (like `doSomething()` or `a = b`) is a valid value, so a `case` whose value was accidentally left off will use its first body line as the value.

## Single-line form
Use `:` to separate statements, like everywhere else in BrightScript:

```brighterscript
select case x : case 1 : print "one" : case else : print "other" : end select

select case x
    case 1: print "one"
    case 2: print "two"
    case else: print "other"
end select
```

## `select case true`
A common VB idiom is to select on `true` and use a condition for each case. The first case whose condition is `true` runs. BrighterScript recognizes this pattern and emits the conditions directly:

```brighterscript
select case true
    case age < 13
        print "child"
    case age < 20
        print "teenager"
    case else
        print "adult"
end select
```

transpiles to:

```brightscript
if age < 13 then
    print "child"
else if age < 20 then
    print "teenager"
else
    print "adult"
end if
```

## The subject is evaluated only once
The subject is evaluated a single time, no matter how many cases there are. When the subject is a local variable or a literal, BrighterScript uses it directly. Anything else (function calls, `m.something`, array lookups, etc.) is stored in a temporary variable first. That way a function isn't called once per case, and a node field isn't read over and over:

```brighterscript
select case getStatus()
    case "ready"
        start()
    case "loading", "buffering"
        showSpinner()
    case else
        showError()
end select
```

transpiles to:

```brightscript
__bsSelectCaseSubject = getStatus()
if __bsSelectCaseSubject = "ready" then
    start()
else if __bsSelectCaseSubject = "loading" or __bsSelectCaseSubject = "buffering" then
    showSpinner()
else
    showError()
end if
```

The same `__bsSelectCaseSubject` variable is reused, even for nested `select case` statements. That's safe because once a case body starts running, the outer `select case` never reads its subject again. Just avoid naming your own variables `__bsSelectCaseSubject`.

## How values are compared
Each value is compared to the subject with BrightScript's `=` operator, so the usual BrightScript rules apply:

- **String comparisons are case-sensitive.** `"Up"` does not match `case "up"`. Normalize first if needed: `select case lcase(key)`.
- **Integers and floats compare fine** against each other (`case 1` matches `1.0`).
- **Comparing mismatched types crashes.** In BrightScript, `"1" = 1` is a runtime `Type Mismatch` error, not `false`. BrighterScript warns when a literal case value has a different type than the subject or the other literal values:

  ```brighterscript
  select case 1
      case "1" ' warning: comparing a string against a number crashes at runtime
  end select
  ```

  BrighterScript can only catch this with literal values. If your subject might hold different types at runtime, check the type first (i.e. `select case type(value)`).

Values can be any expression, not just literals. Values that contain their own comparison or logical operators are wrapped in parentheses so they keep their meaning. For example, `case a and b` becomes `subject = (a and b)`.

## Enums and constants
Enums and constants work as case values (or as the subject) and are replaced with their literal values in the output, like they are everywhere else:

```brighterscript
enum Direction
    up = "up"
    down = "down"
end enum

sub move(direction)
    select case direction
        case Direction.up
            m.y -= 1
        case Direction.down
            m.y += 1
        case else
    end select
end sub
```

transpiles to:

```brightscript
sub move(direction)
    if direction = "up" then
        m.y -= 1
    else if direction = "down" then
        m.y += 1
    else
    end if
end sub
```

## Covering every enum member
When the subject is typed as an enum, BrighterScript knows every value it can hold. If your cases cover every member, you don't need a `case else`:

```brighterscript
enum RemoteDirection
    up = "up"
    down = "down"
    left = "left"
    right = "right"
end enum

sub move(direction as RemoteDirection)
    select case direction
        case RemoteDirection.up
            m.y -= 1
        case RemoteDirection.down
            m.y += 1
        case RemoteDirection.left
            m.x -= 1
        case RemoteDirection.right
            m.x += 1
    end select
end sub
```

If you leave a member out, and there's no `case else`, you'll get a warning that names the missing members:

```brighterscript
sub move(direction as RemoteDirection)
    ' warning: 'select case' on 'RemoteDirection' does not handle: left, right
    select case direction
        case RemoteDirection.up
            m.y -= 1
        case RemoteDirection.down
            m.y += 1
    end select
end sub
```

This is most useful when the enum changes. If you later add `center` to `RemoteDirection`, every `select case` on it that has no `case else` gets flagged, so you can find each one that needs a new case.

A few details:
- A member counts as covered if it appears anywhere in a case's value list, either as `RemoteDirection.up` or as its literal value (`"up"`).
- A `case else` counts as handling everything, so there's no coverage warning when there is one.
- The check only happens when the subject's type is known to come from a single enum, i.e. a parameter declared `as RemoteDirection`. If BrighterScript can tell the subject only holds *some* of the members (i.e. a local variable that was only ever assigned `RemoteDirection.up` or `RemoteDirection.down`), only those members need a case. When the type is anything else (`dynamic`, `string`, or unknown), the regular warning for a missing `case else` applies instead, since there's no way to list every possible value.
- Case values that are neither a member reference nor a literal (i.e. `case getDirection()`) don't count as covering any member.
- A case value from a *different* enum than the subject (i.e. `case OtherEnum.up` when the subject is a `RemoteDirection`) is flagged too, because it's almost always a mistake.

## Loops, `exit`, `continue`, and `return`
Because a `select case` becomes an `if` statement, loop control inside a case applies to the enclosing loop, just like it would inside an `if`:

```brighterscript
for each item in items
    select case item.type
        case "header"
            continue for    ' skips to the next item
        case "footer"
            exit for        ' stops the loop
        case else
            render(item)
    end select
end for
```

`return` works the same way.

## `exit select`
`exit select` leaves the `select case` immediately and continues after `end select`, like `exit for` and `exit while` do for loops:

```brighterscript
sub onCommand(command)
    select case command
        case "save"
            if not m.isDirty then
                exit select
            end if
            m.save()
        case else
    end select
    print "done"
end sub
```

BrightScript has no way to leave an `if` early, so an `exit select` in the middle of a case becomes a `goto` to a label placed right after the generated `end if`. This works on every firmware version:

```brightscript
sub onCommand(command)
    if command = "save" then
        if not m.isDirty then
            goto BRIGHTERSCRIPT_EXIT_SELECT_0
        end if
        m.save()
    else
    end if
    BRIGHTERSCRIPT_EXIT_SELECT_0:
    print "done"
end sub
```

When `exit select` is the last statement of a case, there's nothing left to skip, so it's simply removed. That makes it a clear way to write a case that intentionally does nothing (see [no fallthrough](#no-fallthrough)):

```brighterscript
sub onKey(key)
    select case key
        case "back"
            ' handled by the parent screen
            exit select
        case "OK"
            m.select()
        case else
    end select
end sub
```

transpiles to:

```brightscript
sub onKey(key)
    if key = "back" then
        ' handled by the parent screen
    else if key = "OK" then
        m.select()
    else
    end if
end sub
```

The label is only generated when something jumps to it. A `select case` with no `exit select`, or whose only `exit select`s are at the end of a case, gets no label at all. Each `select case` that needs one gets its own numbered label.

`exit select` can't be used:
- outside of a `select case`
- inside a loop within a case (i.e. `case 1 : for each item in items : exit select`). Use `exit for` or `exit while` to leave the loop first.
- inside a function defined within a case (the function has its own body, so there's no `select case` to exit)

In a nested `select case`, `exit select` leaves the innermost one.

## The optional `case` keyword
Like VB, the `case` right after `select` is optional:

```brighterscript
select m.state
    case "idle"
        startPlayback()
    case else
end select
```

This short form only works when the subject starts with a variable name, a literal, or `not`. Writing `select (x)` or `select -x` doesn't work, because BrighterScript can't tell those apart from code that uses a variable or function named `select` (i.e. `select(x)`). When in doubt, write `select case`.

## `select`, `case`, and `endselect` as names
These words were never reserved in BrightScript, so existing code may already use them as variable, function, field, or method names. All of that still works:

```brighterscript
select = 1
case = "upper"
m.case.select()
obj = { select: 1, case: 2 }
sub select(item)
end sub
```

There's one limitation. **Inside** a `select case` body, a line that starts with `case` is always read as the next case. Assignments like `case = 1`, `case.name = 1`, `case[0] = 1`, and `case++` still work. But `case(1)` or `case something` at the start of a line inside a `select case` is read as a new case clause.

## Comments
Comments are kept in the output. A comment on the `select case` line, or between `select case` and the first `case`, is placed above the generated `if`:

```brighterscript
select case a ' what kind of a?
    ' the most common values come first
    case 1 ' one
        print "one"
    case else
end select
```

transpiles to:

```brightscript
' what kind of a?
' the most common values come first
if a = 1 then ' one
    print "one"
else
end if
```

Only comments may appear before the first `case`. Any other statement there is an error.

## Where it can't be used
- **`.brs` files.** `select case` is a BrighterScript feature, so it's only allowed in `.bs` files.
- **Inside an inline `if`.** `if ready then select case x ...` is not allowed. Use a multi-line `if`.

## Not supported (yet)
A few other VB features are not supported:

- Range cases: `case 1 to 5`
- Relational cases: `case is > 5`

For ranges and relational checks, use `select case true` with a condition:

```brighterscript
select case true
    case score >= 90
        grade = "A"
    case score >= 80 and score < 90
        grade = "B"
    case else
        grade = "C"
end select
```

## Diagnostics
Besides the usual syntax errors (a missing `end select`, a `case` with no value, a trailing comma, and so on), BrighterScript checks for these mistakes in `select case` statements:

| Code | Severity | What it means |
|------|----------|---------------|
| `select-case-missing-case-else` | warning | The `select case` has no `case else`, so values that don't match any case are silently ignored. Not reported when the subject is an enum; see `select-case-missing-enum-members` instead. |
| `select-case-missing-enum-members` | warning | The subject is an enum, there's no `case else`, and some enum members aren't handled by any case. The message lists the missing members. |
| `case-value-enum-mismatch` | warning | A case value is a member of a different enum than the subject. |
| `duplicate-case-value` | warning | The same value appears in more than one case. The later one can never match. |
| `case-value-type-mismatch` | warning | A literal case value has a different type than the subject (or than the other literal values). Comparing them crashes at runtime. |
| `empty-case-does-not-fall-through` | warning | A case is empty. It does nothing and does **not** fall through to the next case. Not reported when the case contains a comment or `exit select`. |
| `select-case-has-no-cases` | warning | The `select case` has no cases at all. |
| `statement-before-first-case` | error | A statement (other than a comment) appears before the first `case`. |
| `case-else-must-be-last` | error | `case else` isn't the last case. |
| `duplicate-case-else` | error | There's more than one `case else`. |
| `case-outside-select-case` | error | `case` was used outside of a `select case`. |
| `end-select-without-select-case` | error | `end select` was found without a matching `select case`. |
| `select-case-in-inline-if` | error | A `select case` was used inside an inline `if`. |
| `exit-select-outside-select-case` | error | `exit select` was used outside of a `select case`. |
| `exit-select-in-loop` | error | `exit select` was used inside a loop within a case. Leave the loop with `exit for` or `exit while` first. |

Many teams leave out `case else` on purpose. For enum subjects, covering every member is enough (see [covering every enum member](#covering-every-enum-member)). For everything else, if you don't want the `select-case-missing-case-else` warning, turn it off or lower its severity for your whole project with [`diagnosticSeverityOverrides`](bsconfig.md#diagnosticseverityoverrides) or [`diagnosticFilters`](bsconfig.md#diagnosticfilters) in `bsconfig.json`. To silence it for a single statement, use a `' bs:disable-next-line` comment (see [suppressing compiler messages](suppressing-compiler-messages.md)):

```jsonc
// bsconfig.json
{
    "diagnosticSeverityOverrides": {
        "select-case-missing-case-else": "hint"
    }
}
```
