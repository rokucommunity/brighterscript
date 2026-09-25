# Spread Operator: `...`
The spread operator allows you to expand the contents of an array or associative array into another array or associative array literal. This is useful for cloning, merging, and composing data structures concisely.

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
    result = (function(defaults)
        __bsc_tmp = []
        __bsc_tmp.push(0)
        __bsc_tmp.append(defaults)
        __bsc_tmp.push(4)
        return __bsc_tmp
    end function)(defaults)
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
    result = (function(defaults)
        __bsc_tmp = {}
        __bsc_tmp.append(defaults)
        __bsc_tmp.size = 20
        __bsc_tmp.name = "widget"
        return __bsc_tmp
    end function)(defaults)
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
When a spread expression is present in an array or associative array literal, BrighterScript transpiles the literal into an immediately-invoked function expression (IIFE). Because BrightScript anonymous functions cannot see the enclosing function's local variables, every variable referenced inside the literal is passed into the IIFE as a parameter (the same approach used by the ternary and null-coalescing operators). Inside the IIFE:

- For **arrays**: regular elements are added with `.push()`, and spread elements are expanded with `.append()` (the native `roArray` method that appends all elements from another array).
- For **associative arrays**: regular key/value pairs are assigned directly, and spread elements are expanded with `.append()` (the native `roAssociativeArray` method that merges all entries from another AA, overwriting duplicate keys).

When no spread is present, the literal transpiles normally with no IIFE overhead.

## Limitations
- **Function call spread is not supported.** You cannot use `...` to expand an array into function arguments (e.g., `someFunc(...args)`). BrightScript has no mechanism for dynamically invoking a function with a variable number of arguments.
- **Only available in BrighterScript (`.bs`) files.** Using `...` in a `.brs` file produces a "spread operator is not supported in BrightScript files" diagnostic.
