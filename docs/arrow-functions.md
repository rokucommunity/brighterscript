# Arrow Functions

Arrow functions are a short way to write a function whose body is a single expression, modeled on the `=>` syntax from TypeScript/JavaScript. They are most useful for small callbacks passed to other functions.

```brighterscript
adults = utils.filter(people, (p) => p.age >= 18)
```

transpiles to

```brightscript
adults = utils_filter(people, function(p)
    return p.age >= 18
end function)
```

## Syntax

An arrow function is a parenthesized parameter list, an optional return type, `=>`, and a single expression that becomes the function's return value. Parameters use the same syntax as regular functions, so types, optional parameters and default values all work.

```brighterscript
' no params
getZero = () => 0

' single param (parens are required, even for one param)
double = (x) => x * 2

' multiple params
add = (a, b) => a + b

' typed params and return type
add = (a as integer, b as integer) as integer => a + b

' optional params with default values
greet = (name = "world") => "hello " + name

' passed as an argument
names = map(people, (p) => p.name)

' returning an associative array literal (wrap it in parens)
makePoint = (x, y) => ({ x: x, y: y })
```

The body extends as far to the right as possible, so `(a) => a ? 1 : 2` returns the whole ternary expression.

## Transpilation

An arrow function compiles to an ordinary anonymous function that returns its expression:

```brighterscript
add = (a as integer, b as integer) as integer => a + b
```

```brightscript
add = function(a as integer, b as integer) as integer
    return a + b
end function
```

When the body is a call to something that returns nothing (a `sub`, or a built-in method like `push`), the arrow function compiles to a `sub` whose body is a plain statement, since `return list.push(item)` is not valid on device:

```brighterscript
addItem = (list as integer[], item as integer) => list.push(item)
```

```brightscript
addItem = sub(list as dynamic, item as integer)
    list.push(item)
end sub
```

## Type checking

Arrow functions are type-checked exactly like anonymous functions. They can be used anywhere a [function type](function-types.md) is expected, and their arguments and return values are validated.

Without an explicit return type, the return type is inferred from the body expression:

```brighterscript
sub apply(callback as function(x as integer) as integer)
end sub

' ok
apply((x as integer) => x * 2)

' error: "function (x as string) as string" is not compatible with "function (x as integer) as integer"
apply((x as string) => x + "!")
```

## Closures

An arrow function that uses a variable from the function it is written in becomes a **closure**: it captures a copy of that variable when it is created, transpiles to an object instead of a plain function, and can only be passed where a `closure(...)` type is declared. See [closures](closures.md) for the details and the rules that come with it.

```brighterscript
sub main()
    factor = 2
    scale = (x) => x * factor ' a closure: captures `factor`
    print scale(10)
end sub
```

`m` is not allowed inside an arrow function (closure or not). Pass the value you need in as an argument instead:

```brighterscript
' error: 'm' cannot be used inside an arrow function
render = (data) => m.view.setData(data)

' ok
render = (data, view) => view.setData(data)
render(data, m.view)
```

An arrow function that captures nothing and does not use `m` is a plain BrightScript function. It can be passed anywhere a function can: parameters typed `as function` or with a function type, untyped (`dynamic`) parameters, and compiled `.brs` libraries that simply call `callback(x)`.

## Limitations

- The body must be a single expression. For multiple statements, use a regular `function ... end function`.
- Parameters must be in parentheses, even when there is only one: `(x) => x * 2`, not `x => x * 2`.
- Arrow functions are a BrighterScript feature and are not available in `.brs` files.
