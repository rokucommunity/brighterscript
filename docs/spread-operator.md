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

If any element after the spread reads from the target itself (for example `list = [...list, 4]` or `m.items = [...m.items, item]`), the literal is built in a temporary variable first and assigned to the target at the end, so those reads still see the original value:

```brightscript
__bsc_tmp = []
__bsc_tmp.append(list)
__bsc_tmp.push(4)
list = __bsc_tmp
```

Literals without a spread transpile exactly as they always have.

## Limitations
- **The literal must be the direct right-hand side of an assignment.** Spread is supported when the array or AA literal is assigned to a variable (`x = [...a]`), a property (`m.x = [...a]`), or an index (`m["x"] = [...a]`). Using it anywhere else — a function argument, a `return` value, a nested literal, an augmented assignment such as `x += [...a]` — reports a diagnostic. This keeps the transpiled output to simple statements rather than wrapping the literal in a function.
- **Function call spread is not supported.** You cannot use `...` to expand an array into function arguments (e.g., `someFunc(...args)`). BrightScript has no mechanism for dynamically invoking a function with a variable number of arguments.
- **Only available in BrighterScript (`.bs`) files.** Using `...` in a `.brs` file produces a "spread operator is not supported in BrightScript files" diagnostic.
