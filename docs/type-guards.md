# BrighterScript Type Guards

A type guard is a function that checks the type of one of its arguments. Its return type is written as a type predicate, `<parameter> is <type>`, instead of `boolean`.

```brighterscript
function isNode(value) as value is roSGNode
    return type(value) = "roSGNode"
end function
```

When a type guard is called in an `if` statement's condition, the argument's type is narrowed inside the `if` statement:

```brighterscript
sub printId(value as string or roSGNode)
    if isNode(value)
        print value.id ' value is known to be roSGNode
    else
        print value ' value is known to be string
    end if
end sub
```

## Transpiled output

BrightScript has no type predicates, so type guards are transpiled to functions that return `boolean`:

```brightscript
function isNode(value) as boolean
    return type(value) = "roSGNode"
end function
```

## Rules

- The parameter named in the type predicate must be one of the function's parameters.
- The type in the type predicate must be assignable to that parameter's type.
- The function must return a `boolean`.
- The compiler trusts the type guard. It does not check that the function's body actually checks the type.

## Narrowing

- In the `then` branch, the argument is narrowed to the guarded type. If the argument's type is a union, only the members of the union that match the guard are kept.
- In the `else` branch, the guarded type is removed from the argument's type.
- `not`, `and` and `or` are supported, as well as `else if` branches and nested `if` statements.
- The right side of `and` and `or` is narrowed too, i.e. `isNode(value) and value.id = "main"`.
- Ternary expressions are narrowed too, i.e. `isNode(value) ? value.id : ""`.
- Narrowing stops once the variable is assigned a new value inside the branch.

```brighterscript
sub example(a as string or roSGNode, b as string or roSGNode)
    if isNode(a) and not isNode(b)
        print a.id ' a is roSGNode
        print b ' b is string
    end if
end sub
```

## Loops and select case

The body of a `while` loop is narrowed by its condition. After the loop, the condition is known to be false, unless the loop has an `exit while`:

```brighterscript
sub waitForNode(value)
    while not isNode(value)
        value = getNextValue()
    end while
    print value.id ' value is known to be roSGNode
end sub
```

In a `select case true` (or `select case false`), each case is narrowed by its values, and by the earlier cases not matching. A case with several values is narrowed to any of their types:

```brighterscript
sub describe(value as string or roSGNode or roArray)
    select case true
        case isNode(value)
            print value.id ' roSGNode
        case isArray(value)
            print value.count() ' roArray
        case else
            print value ' string
    end select
end sub
```

## Members

Members (including members of members, and members of `m`) are narrowed too:

```brighterscript
sub render()
    if isNode(m.top.content)
        print m.top.content.id ' m.top.content is known to be roSGNode
    end if
end sub
```

- Literal indexes work like members: `m.top["content"]` is the same as `m.top.content`, and `items[0]` is narrowed by `isNode(items[0])`. Indexes that aren't literals (`items[i]`) are not narrowed.
- Narrowing of a member stops when it, or an object it belongs to, is assigned. i.e. `m.top = other` or `m.top["content"] = other` stop the narrowing of `m.top.content`. Assigning a member of the narrowed member (`m.top.content.id = "main"`) does not.
- Like in TypeScript, calling a function does not stop the narrowing, even though the function could change the member.

## Early exits

When a branch of an `if` statement always leaves the block (with `return`, `exit sub`, `exit function`, `exit for`, `exit while`, `continue`, `throw` or `end`), the statements after the `if` statement are narrowed by the conditions that let control get past it:

```brighterscript
sub printId(value as string or roSGNode)
    if not isNode(value) then return
    print value.id ' value is known to be roSGNode for the rest of the sub
end sub
```

- A branch counts as exiting when it ends with one of those statements, or with an `if`/`else` (or `try`/`catch`) where every branch exits.
- If there are several ways past the `if` statement, the variable is narrowed to the union of the types on each of them.
- `exit for`, `exit while` and `continue` narrow the rest of the loop body, not the code after the loop.
- Narrowing stops at an assignment to the variable, including one inside the `if` statement itself.
- Functions that use `goto` are not narrowed by early exits, since a `goto` can jump past the check.

Type guards can also be used in interface methods and function types:

```brighterscript
interface Validator
    function isValid(value) as value is roSGNode
end interface

sub check(value, guard as function(value) as value is roSGNode)
    if guard(value)
        print value.id
    end if
end sub
```
