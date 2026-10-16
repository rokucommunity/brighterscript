# Tuples

A tuple is an array with a fixed number of elements, where each position has its own type. Tuples are useful for pairs, coordinates, and functions that return more than one value. The syntax matches [tuple types in TypeScript](https://www.typescriptlang.org/docs/handbook/2/objects.html#tuple-types).

## Syntax

A tuple type is a comma-separated list of types inside square brackets. It can be used anywhere a type is expected: parameters, return types, typed assignments, typecasts, and [type statements](type-statements.md).

```brighterscript
type StringIntegerPair = [string, integer]

function getPair() as [string, integer]
    return ["hello", 42]
end function

sub main(pair as StringIntegerPair)
    first as [string, integer] = getPair()
    second = parseJson(text) as [string, integer]
    print pair[0]; first[1]
end sub
```

Elements may be separated by commas, newlines, or both, and a trailing comma is allowed:

```brighterscript
type Point = [
    float,
    float,
]
```

Tuple types can be nested and combined with other types:

```brighterscript
sub main(cell as [[integer, integer], string], grid as [integer, integer][], maybe as [string, integer] or boolean)
end sub
```

### Optional elements

A `?` after an element's type marks it as optional, meaning the tuple may end before that position. Optional elements must come after all required elements:

```brighterscript
type Point = [float, float, float?]
```

### Rest elements

A rest element, written as `...` followed by an array type, allows any number of extra elements of that type at the end of the tuple. It must be the last element and cannot be optional:

```brighterscript
type Row = [string, ...integer[]]
```

The following are errors:

```brighterscript
sub main(a as [string?, integer], b as [...string[], integer], c as [...string[]?])
    '                    ~~~~~~~ a required element cannot follow an optional element
    '                                       ~~~~~~~~~~~ a rest element must be last
    '                                                           ~~~~~~~~~~~~ a rest element cannot be optional
end sub
```

## Transpilation

BrightScript has no tuple type, and a tuple is an ordinary `roArray` at runtime, so tuple types transpile to `dynamic` in the same way as [typed arrays](typed-arrays.md). Typecasts are removed.

```brighterscript
function getPair() as [string, integer]
    return ["hello", 42]
end function

sub main(pair as [string, integer])
    other = pair as [string, integer]
end sub
```

transpiles to

```brightscript
function getPair() as dynamic
    return [
        "hello"
        42
    ]
end function

sub main(pair as dynamic)
    other = pair
end sub
```

## Limitations

- Tuple types are a BrighterScript feature and are not available in `.brs` files.
- A rest element must be the last element. TypeScript also allows a rest element at the start or in the middle of a tuple (`[...string[], integer]`); BrighterScript does not.
- A tuple typecast followed by an index must be parenthesized: `(data as [string, integer])[0]`. Without the parentheses the `[0]` is read as part of the type, the same as with typed arrays.
- Elements cannot be labeled (`[name as string, age as integer]` is not supported).
- Array literals are never inferred to be tuples. `x = ["a", 1]` is an `Array<string or integer>`; a literal is only treated as a tuple where a tuple type is declared.
