# Spread Operator: `...`
The spread operator expands the contents of an array or associative array into another array or associative array literal. This is useful for cloning, merging, and composing data structures concisely.

## Array Spread
Use `...` inside an array literal to expand another array's elements inline.

### Basic usage
```brighterscript
sub main()
    defaults = [1, 2, 3]
    result = [0, ...defaults, 4]
    ' result is [0, 1, 2, 3, 4]
end sub
```

transpiles to:
```brightscript
sub main()
    defaults = [
        1
        2
        3
    ]
    result = [
        0
    ]
    result.append(defaults)
    result.push(4)
    ' result is [0, 1, 2, 3, 4]
end sub
```

### Cloning an array
```brighterscript
clone = [...original]
```

### Merging arrays
```brighterscript
merged = [...first, ...second, ...third]
```

## Associative Array Spread
Use `...` inside an associative array literal to merge another AA's key/value pairs inline. Later keys overwrite earlier ones with the same name.

### Basic usage
```brighterscript
sub main()
    defaults = { color: "red", size: 10 }
    result = { ...defaults, size: 20, name: "widget" }
    ' result is { color: "red", size: 20, name: "widget" }
end sub
```

transpiles to:
```brightscript
sub main()
    defaults = {
        color: "red"
        size: 10
    }
    result = {}
    result.append(defaults)
    result.size = 20
    result.name = "widget"
end sub
```

### Cloning an AA
```brighterscript
clone = {...original}
```

### Merging AAs
```brighterscript
merged = {...defaults, ...overrides}
```

## How it works
A literal containing a spread is lowered into plain statements, so there is no runtime helper or anonymous function involved:

1. Elements before the first spread stay in the literal, which is assigned as normal.
2. Each remaining element becomes a statement against the assigned target: spreads call `.append()` (the native `roArray` / `roAssociativeArray` method), other array elements call `.push()`, and other AA members become property or index assignments. Order is preserved.
3. A run of eight or more plain array elements after a spread is appended together as a single literal — `result.append([1, 2, 3, 4, 5, 6, 7, 8])` — since at that size one append is cheaper than the individual pushes. AA members are never grouped this way: individual property sets are faster than appending a literal at every size measured.

The literal is built in a temporary local variable and assigned to the target at the end in two situations:

- **The target is not a plain local variable** (`m.items = [...]`, `store["items"] = [...]`). Statements against a local are 10-40% faster than repeatedly re-evaluating `m.items`.
- **An element after the spread reads the target itself** (`list = [...list, 4]`), so the read still sees the original value.

The temporary is always named `__bsc_tmp_spread`. Building the literal first and assigning it last matches native evaluation order: BrightScript evaluates the right-hand side before any expression in the assignment target, so `store[nextKey()] = [...a, f()]` still calls `f()` before `nextKey()`.

```brightscript
__bsc_tmp_spread = []
__bsc_tmp_spread.append(m.items)
__bsc_tmp_spread.push(item)
m.items = __bsc_tmp_spread
```

These choices were measured on device with the `SpreadTrailing*` suites in [bsbench](https://github.com/rokucommunity/bsbench). Literals without a spread transpile exactly as they always have.

## Type checking
When the compiler knows the type of the value being spread, it checks that `.append()` can take it: an array literal needs an array-like value and an associative array literal needs an AA-like value (an AA, a user-defined interface, or a class instance). Anything else reports a `spread-value-type-mismatch` diagnostic:

```brighterscript
sub main(node as roSGNode, items as integer[], config as roAssociativeArray)
    a = { ...5 }        ' Cannot spread 'integer' into an associative array literal
    b = [ ...config ]   ' Cannot spread 'roAssociativeArray' into an array literal
    c = { ...invalid }  ' Cannot spread 'invalid' into an associative array literal
    d = { ...node }     ' Cannot spread 'roSGNode' into an associative array literal
    e = { ...items }    ' Cannot spread 'Array<integer>' into an associative array literal
end sub
```

Values typed `dynamic` or `object`, and values whose type cannot be resolved, are not checked. Note that unlike JavaScript, spreading `invalid` is not a no-op: it becomes `.append(invalid)` at runtime, so the compiler flags it.

## Limitations
- **The literal must be the direct right-hand side of an assignment.** Spread is supported when the array or AA literal is assigned to a variable (`x = [...a]`), a property (`m.x = [...a]`), or an index (`m["x"] = [...a]`). Using it anywhere else — a function argument, a `return` value, a nested literal, an augmented assignment such as `x += [...a]` — reports a diagnostic. This keeps the transpiled output to simple statements rather than wrapping the literal in a function.
- **Function call spread is not supported.** You cannot use `...` to expand an array into function arguments (e.g., `someFunc(...args)`). BrightScript has no mechanism for dynamically invoking a function with a variable number of arguments.
- **Only available in BrighterScript (`.bs`) files.** Using `...` in a `.brs` file produces a "spread operator is not supported in BrightScript files" diagnostic.
