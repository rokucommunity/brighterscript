# Closures (prototype)

> This is a prototype for [#530](https://github.com/rokucommunity/brighterscript/issues/530). The design is open for discussion; nothing here is final.

A closure is an [arrow function](arrow-functions.md) that uses a variable from the function it is written in:

```brighterscript
sub main()
    factor = 2
    scale = (x as integer) => x * factor
    print scale(10) ' 20
end sub
```

An arrow function that uses only its own parameters and file-level names stays a plain BrightScript function (see [arrow functions](arrow-functions.md)). It becomes a closure as soon as its body (or a default parameter value) refers to a local variable or parameter of the enclosing function.

## What this makes possible

Each of these is a pattern that takes context objects and string-named callbacks to write in BrightScript today. The mechanics behind the output are explained in the sections that follow.

### Composing functions

Closures can capture other closures. Here `compose` receives two closures and returns a third that calls both:

```brighterscript
function compose(f as closure(x as integer) as integer, g as closure(x as integer) as integer) as closure(x as integer) as integer
    return (x as integer) => g(f(x))
end function

sub main()
    factor = 3
    offset = 10
    scaleThenShift = compose((x as integer) => x * factor, (x as integer) => x + offset)
    print scaleThenShift(2) ' 16
end sub
```

transpiles to

```brightscript
function compose(f as object, g as object) as object
    return {
        ctx: {
            g: g
            f: f
        }
        fn: function(__bsc_ctx, x as integer)
            g = __bsc_ctx.g
            f = __bsc_ctx.f
            return g.fn(g.ctx, f.fn(f.ctx, x))
        end function
    }
end function

sub main()
    factor = 3
    offset = 10
    scaleThenShift = compose({
        ctx: {
            factor: factor
        }
        fn: function(__bsc_ctx, x as integer)
            factor = __bsc_ctx.factor
            return x * factor
        end function
    }, {
        ctx: {
            offset: offset
        }
        fn: function(__bsc_ctx, x as integer)
            offset = __bsc_ctx.offset
            return x + offset
        end function
    })
    print scaleThenShift.fn(scaleThenShift.ctx, 2) ' 16
end sub
```

The two inline arrow functions become closures because `compose` declares its parameters as closures, and `g(f(x))` inside the body is rewritten for the same reason.

### A list of rules

Closure types work inside typed arrays, so a `for each` over `(closure(...) as boolean)[]` knows each element is a closure and calls it correctly:

```brighterscript
function atLeast(min as integer) as closure(value as integer) as boolean
    return (value as integer) => value >= min
end function

function atMost(max as integer) as closure(value as integer) as boolean
    return (value as integer) => value <= max
end function

function passesAll(value as integer, rules as (closure(value as integer) as boolean)[]) as boolean
    for each rule in rules
        if not rule(value) then return false
    end for
    return true
end function

sub main()
    rules = [atLeast(1), atMost(10)]
    print passesAll(5, rules)
    print passesAll(50, rules)
end sub
```

transpiles to

```brightscript
function atLeast(min as integer) as object
    return {
        ctx: {
            min: min
        }
        fn: function(__bsc_ctx, value as integer)
            min = __bsc_ctx.min
            return value >= min
        end function
    }
end function

function atMost(max as integer) as object
    return {
        ctx: {
            max: max
        }
        fn: function(__bsc_ctx, value as integer)
            max = __bsc_ctx.max
            return value <= max
        end function
    }
end function

function passesAll(value as integer, rules as dynamic) as boolean
    for each rule in rules
        if not rule.fn(rule.ctx, value) then
            return false
        end if
    end for
    return true
end function

sub main()
    rules = [
        atLeast(1)
        atMost(10)
    ]
    print passesAll(5, rules)
    print passesAll(50, rules)
end sub
```

### Memoizing with a captured cache

Captured objects are references, so a closure can share mutable state as long as the mutation happens in a regular function:

```brighterscript
function memoize(fn as closure(key as string) as string) as closure(key as string) as string
    cache = {}
    return (key as string) => lookupOrCompute(cache, key, fn)
end function

function lookupOrCompute(cache as object, key as string, fn as closure(key as string) as string) as string
    if not cache.doesExist(key) then cache[key] = fn(key)
    return cache[key]
end function

sub main()
    prefix = "Hello, "
    greet = memoize((name as string) => prefix + name)
    print greet("Bron")
    print greet("Bron") ' computed once
end sub
```

transpiles to

```brightscript
function memoize(fn as object) as object
    cache = {}
    return {
        ctx: {
            cache: cache
            fn: fn
        }
        fn: function(__bsc_ctx, key as string)
            cache = __bsc_ctx.cache
            fn = __bsc_ctx.fn
            return lookupOrCompute(cache, key, fn)
        end function
    }
end function

function lookupOrCompute(cache as object, key as string, fn as object) as string
    if not cache.doesExist(key) then
        cache[key] = fn.fn(fn.ctx, key)
    end if
    return cache[key]
end function

sub main()
    prefix = "Hello, "
    greet = memoize({
        ctx: {
            prefix: prefix
        }
        fn: function(__bsc_ctx, name as string)
            prefix = __bsc_ctx.prefix
            return prefix + name
        end function
    })
    print greet.fn(greet.ctx, "Bron")
    print greet.fn(greet.ctx, "Bron") ' computed once
end sub
```

## Captured values are copied when the closure is created

BrightScript has no way to share a variable between two functions, so a closure holds a *copy* of each captured variable, taken at the moment the arrow function is evaluated. To keep that from being surprising, assigning to a captured variable after the closure is created is an error:

```brighterscript
sub main()
    count = 1
    get = () => count
    count = 2 ' error: 'count' is captured by a closure and cannot be reassigned afterwards
end sub
```

Assignments *before* the closure are fine, and so is capturing a loop variable inside the loop: every iteration creates a new closure holding that iteration's value.

```brighterscript
for each item in items
    show = () => item ' each closure holds the item of its own iteration
    print show()
end for
```

Captured objects (AAs, arrays, nodes) are references, as always, so changes to their *contents* are visible to the closure.

## Transpilation

A closure is an associative array holding the captured values (`ctx`) and a function that receives them as its first argument and unpacks them into locals (`fn`). This BrighterScript:

```brighterscript
sub main()
    offset = 1
    factor = 2
    unused = 3
    scale = (x as integer) => x * factor + offset
    print scale(10)
end sub
```

transpiles to this BrightScript:

```brightscript
sub main()
    offset = 1
    factor = 2
    unused = 3
    scale = {
        ctx: {
            factor: factor
            offset: offset
        }
        fn: function(__bsc_ctx, x as integer)
            factor = __bsc_ctx.factor
            offset = __bsc_ctx.offset
            return x * factor + offset
        end function
    }
    print scale.fn(scale.ctx, 10)
end sub
```

Only the variables the arrow function actually references are captured (`unused` is not), and they appear in `ctx`, and are unpacked, in the order the body first references them (`factor` before `offset` above), so the output reads like the source. The cost of a closure is therefore proportional to the number of captured variables: one AA entry when it is created and one assignment each time it is called.

Because the body is left untouched (the captured values are simply assigned to locals at the top of `fn`), everything that works inside an arrow function works inside a closure. Nested closures capture from the unpacked locals of the closure around them.

Calls on a closure are rewritten to `x.fn(x.ctx, ...)` wherever the compiler knows the callee is a closure: local variables (as `scale` above), parameters and fields declared with a closure type, and functions declared to return one. A call on a more complex expression is wrapped in a small function so the closure is evaluated only once:

```brighterscript
print makeScaler(2)(5)
```

transpiles to

```brightscript
print (function(__bsc_closure, __bsc_arg0)
    return __bsc_closure.fn(__bsc_closure.ctx, __bsc_arg0)
end function)(makeScaler(2), 5)
```

## The `closure` type

Code that receives a closure must say so, using the same syntax as [function types](function-types.md) with the `closure` keyword:

```brighterscript
sub apply(callback as closure(x as integer) as integer)
    print callback(1)
end sub

function makeScaler(factor as integer) as closure(x as integer) as integer
    return (x as integer) => x * factor
end function
```

transpiles to

```brightscript
sub apply(callback as object)
    print callback.fn(callback.ctx, 1)
end sub

function makeScaler(factor as integer) as object
    return {
        ctx: {
            factor: factor
        }
        fn: function(__bsc_ctx, x as integer)
            factor = __bsc_ctx.factor
            return x * factor
        end function
    }
end function
```

`closure` is only a keyword in a type position followed by `(`, so a variable named `closure` keeps working. Closure types transpile to `object`, since a closure is an associative array at runtime.

An arrow function passed to a closure-typed parameter, or assigned to a closure-typed variable, is compiled as a closure even if it captures nothing (with an empty `ctx`), so a `closure(...)` parameter accepts any arrow function.

## Closures are not plain functions

A closure is an object at runtime, so anything that would call it like a plain function (`callback(x)`) would fail on device. The compiler therefore refuses to let a closure flow anywhere that is not declared as a closure:

```brighterscript
sub takesFunction(callback as function)
end sub
sub takesAnything(callback)
end sub

sub main()
    factor = 2
    scale = (x as integer) => x * factor
    takesFunction(scale)  ' error: closure cannot be passed to a parameter of type 'function'
    takesAnything(scale)  ' error: closure cannot be passed to a parameter of type 'dynamic'
end sub
```

The same applies to assigning a closure to a `function`-typed variable, and to returning one from a function without a `closure(...)` return type. Conversely, a plain function is not accepted where a closure is expected.

This is deliberate: it keeps closures free of any runtime type checks, and keeps every arrow function that captures nothing a plain function that works with existing callback-taking code.

## Not supported

- `m` inside an arrow function is still an error, closure or not (what it should mean is a separate decision).
- Multi-statement bodies. A closure body is a single expression, so a closure can never *assign* to a captured variable; the "copied at creation" rule only matters for the enclosing function.
- Passing a closure to compiled `.brs` libraries, string-named callbacks (`observeField`, Task `functionName`) or node fields. Those need a plain function name or value.
