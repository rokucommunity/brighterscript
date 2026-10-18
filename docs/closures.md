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
    handlers.push(() => item) ' each closure sees its own item
end for
```

Captured objects (AAs, arrays, nodes) are references, as always, so changes to their *contents* are visible to the closure.

## Transpilation

A closure is an associative array holding the captured values (`ctx`) and a function that receives them as its first argument and unpacks them into locals (`fn`):

```brighterscript
sub main()
    offset = 1
    factor = 2
    unused = 3
    scale = (x as integer) => x * factor + offset
    print scale(10)
end sub
```

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

Calls on a closure are rewritten wherever the compiler knows the callee is a closure: local variables, parameters and fields declared with a closure type, and functions declared to return one. A call on a more complex expression (`makeScaler(2)(5)`) is wrapped so the closure is evaluated once.

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

`closure` is only a keyword in a type position followed by `(`, so a variable named `closure` keeps working. Closure types transpile to `object`.

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
