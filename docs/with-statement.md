# With Statement

The `with` statement lets you set properties and call methods on a single object without repeating the object's name on every line. Inside the block, any member access that starts with a `.` (`.name`, `.doSomething()`) refers to the object named after `with`.

It is modeled on the [`With...End With` statement from Visual Basic](https://learn.microsoft.com/en-us/dotnet/visual-basic/language-reference/statements/with-end-with-statement).

## Syntax

```brighterscript
with <expression>
    ' leading-dot statements and nested with blocks
end with
```

`<expression>` can be any expression: a variable, a property chain, a function call, and so on.

## Example

```brighterscript
sub configureLabel(label as roSGNodeLabel)
    with label
        .text = "Hello"
        .color = "#FFFFFF"
        .font.size = 32
        .setFocus(true)
    end with
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub configureLabel(label as object)
    label.text = "Hello"
    label.color = "#FFFFFF"
    label.font.size = 32
    label.setFocus(true)
end sub
```
</details>

The block itself produces no code: every `.member` is rewritten to `target.member`.

## How the target is transpiled

When the target is a plain variable, as above, it is used directly. Any other target (a property chain, a function call, a literal, a nested `.member`) is evaluated **once**, when the block is entered, into a local variable, and every `.member` reads from that local:

```brighterscript
with m.top.findNode("title")
    .text = "Hello"
    .visible = true
end with
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
__bsc_tmp_with0 = m.top.findNode("title")
__bsc_tmp_with0.text = "Hello"
__bsc_tmp_with0.visible = true
```
</details>

So a function call used as the target runs only once, and a property chain is not re-read for every member.

## What can go inside the block

Every statement in a `with` block must start with a leading-dot member, or be a nested `with` block. Within those statements, `.member` can appear anywhere an expression is allowed:

```brighterscript
with m.user
    .name = "Ann"                         ' assignment
    .loginCount++                         ' increment
    .score += 10                          ' compound assignment
    .save()                               ' method call
    .fullName = .firstName + .lastName    ' in an expression
    .sendEmail(.email, .name)             ' as an argument
end with
```

Any other statement (`print`, a call to a function that is not a member of the target, an assignment to a local variable, `if`, loops, `goto`, labels, and so on) is flagged as an unexpected token:

```brighterscript
with m.top.findNode("title")
    .text = "Hello"
    print .text       ' error: Unexpected token 'print'
    runFunction()     ' error: Unexpected token 'runFunction'
    .setFocus(true)
end with
```

A function defined in the block (for example `.callback = function() ... end function`) is its own body and can contain any statements.

## Nesting

`with` blocks can be nested. Inside the inner block, `.member` refers to the inner target; the outer target is not accessible until the inner block ends.

The inner block's target may itself be a leading-dot member access, which refers to the outer target:

```brighterscript
with order
    .id = 123
    with .customer
        .name = "Ann"       ' order.customer.name
        .city = "Redmond"   ' order.customer.city
    end with
    .total = 99.5           ' order.total
end with
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
order.id = 123
__bsc_tmp_with0 = order.customer
__bsc_tmp_with0.name = "Ann"
__bsc_tmp_with0.city = "Redmond"
order.total = 99.5
```
</details>

## When the target is evaluated

A plain-variable target is used directly, so every `.member` reads that variable as it is at that point. Any other kind of target is evaluated once, when the block is entered. A leading-dot statement that changes the source of the target (for example, a method that reassigns `m.current`) doesn't affect the rest of the block:

```brighterscript
with m.current
    .advance()      ' even if this reassigns m.current...
    .name = "x"     ' ...this still sets `name` on the ORIGINAL m.current
end with
```

## Rules

- Every statement in the block must start with a `.member`, or be a nested `with` block. Anything else is an error.
- Every `.member` must be inside a `with` block. Using one outside a block is an error.
- A function defined inside a `with` block (an anonymous `function` or `sub`) cannot use `.member`. BrightScript functions cannot access the local variables of the function that contains them, so the target is not available there. Assign it to a variable and pass that in instead.
- You cannot `goto` a label inside a `with` block from outside the block, because that would skip the step that evaluates the target.
- Type checking, hover and completions work on `.member` just as they would on `target.member`. Typing `.` inside a block offers the target's members.

## `with` as an identifier

`with` is not a reserved word in BrightScript, so existing code may use it as a variable or function name. BrighterScript keeps that code working:

```brighterscript
with = 1          ' assignment to a variable named `with`
print with        ' a variable named `with`
with.foo = 1      ' a member of a variable named `with`
with(1)           ' a call to a function named `with`
with[0] = 1       ' indexing a variable named `with`
```

When `with` is immediately followed (with no space) by `.`, `(` or `[`, it is treated as a variable. With a space in between it opens a block:

```brighterscript
with(a)      ' calls a function named `with`
with (a)     ' a `with` block whose target is `(a)`
with.b = 1   ' sets `b` on a variable named `with`
with .b      ' a nested `with` block whose target is `.b`
```
