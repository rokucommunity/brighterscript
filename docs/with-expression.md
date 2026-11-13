# With Expression

The `with` expression lets you set properties and call methods on a single object without repeating the object's name on every line. Inside the block, any member access that starts with a `.` (`.name`, `.doSomething()`) refers to the object named after `with`.

It is modeled on the [`With...End With` statement from Visual Basic](https://learn.microsoft.com/en-us/dotnet/visual-basic/language-reference/statements/with-end-with-statement).

## Syntax

```brighterscript
with <expression>
    ' leading-dot statements and nested with blocks
end with
```

`<expression>` can be any expression: a variable, a property chain, a function call, and so on.

A `with` block can stand on its own, be the entire value of an assignment (`x = with <expression> ... end with`), or be the entire value of a `return` (`return with <expression> ... end with`). See [Assigning and returning the target](#assigning-and-returning-the-target).

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
sub configureLabel(label as dynamic)
    label.text = "Hello"
    label.color = "#FFFFFF"
    label.font.size = 32
    label.setFocus(true)
end sub
```
</details>

The block itself produces no code: every `.member` is rewritten to `target.member`.

## How the target is transpiled

When the target is a plain variable, as above, it is used directly. Any other target (a property chain, a function call, a literal, a nested `.member`, or a constant, which has no variable at runtime) is evaluated **once**, when the block is entered, into a local variable, and every `.member` reads from that local:

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

## Namespaces

A target that refers to something in a [namespace](namespaces.md) transpiles the same way it would anywhere else: the namespaced name is flattened (`utils.getScene()` becomes `utils_getScene()`). Because a call is not a plain variable, its result is stored in a local:

```brighterscript
namespace utils
    function getScene() as object
        return m.top.getScene()
    end function
end namespace

sub main()
    with utils.getScene()
        .backgroundColor = "red"
    end with
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function utils_getScene() as object
    return m.top.getScene()
end function

sub main()
    __bsc_tmp_with0 = utils_getScene()
    __bsc_tmp_with0.backgroundColor = "red"
end sub
```
</details>

The same applies to a relative name used inside the namespace (`with getScene()` inside `namespace utils`), a namespaced class (`with new utils.Theme()`) and a namespaced constant (`with utils.COLORS`). Leading-dot members are type checked against the target's type, just as they are for any other target.

## What can go inside the block

Every statement in a `with` block must start with a leading `.`, or be a nested `with` block. Within those statements, `.member` can appear anywhere an expression is allowed:

```brighterscript
with m.user
    .name = "Ann"                         ' assignment
    .loginCount++                         ' increment
    .score += 10                          ' compound assignment
    .save()                               ' method call
    .fullName = .firstName + .lastName    ' in an expression
    .sendEmail(.email, .name)             ' as an argument
    .onReady?()                           ' with optional chaining
    .title = .metadata?.title             ' optional chaining in an expression
end with
```

Optional chaining after a leading-dot member (`.doSomething?()`, `.a?.b`, `.items?[0]`) is kept as written, so `.doSomething?()` becomes `target.doSomething?()`.

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

## Indexing the target

Use `.[index]` to index into the target itself, for example when the target is an array:

```brighterscript
arr = []
with arr
    .[0] = "First slot"
    .[1] = "Second slot"
end with
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
arr = []
arr[0] = "First slot"
arr[1] = "Second slot"
```
</details>

`.[index]` works anywhere `.member` does, and can be chained like any other member access: `.[0].title = .[1]`.

## Assigning and returning the target

A `with` block evaluates to its target, so it can be the value of an assignment. The target is assigned to the variable, and the body runs against that variable:

```brighterscript
scene = with utils.getScene()
    .backgroundColor = "red"
end with
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
scene = utils_getScene()
scene.backgroundColor = "red"
```
</details>

It can also be the value of a `return`. The body runs first, then the target is returned:

```brighterscript
function createLabel() as object
    return with CreateObject("roSGNode", "Label")
        .text = "Hello"
        .color = "#FFFFFF"
    end with
end function
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function createLabel() as object
    __bsc_tmp_with0 = CreateObject("roSGNode", "Label")
    __bsc_tmp_with0.text = "Hello"
    __bsc_tmp_with0.color = "#FFFFFF"
    return __bsc_tmp_with0
end function
```
</details>

In both forms the `with` block must be the entire value: nothing may come before `with` or after `end with`. These are errors:

```brighterscript
total = 1 + with order      ' something before `with`
end with

name = with order
end with + "x"              ' something after `end with`

m.order = with order        ' only a plain variable assignment can take a `with` block
end with
```

Anywhere else (an argument, an operand, a property assignment, a `print`), `with` is read as a variable named `with`, as it always has been.

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

- Every statement in the block must start with a leading `.` (`.member` or `.[index]`), or be a nested `with` block. Anything else is an error.
- A `with` block can be a statement on its own, or the entire value of a local variable assignment or a `return`. Nothing may come before `with` or after `end with` on those lines.
- Every `.member` must be inside a `with` block. Using one outside a block is an error.
- A function defined inside a `with` block (an anonymous `function` or `sub`) cannot use `.member`. BrightScript functions cannot access the local variables of the function that contains them, so the target is not available there. Assign it to a variable and pass that in instead.
- Labels are not allowed inside a `with` block. A `goto` that targets one is also flagged, because jumping into the block would skip the step that evaluates the target.
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
