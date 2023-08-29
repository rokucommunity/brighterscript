# Typed Arrays

BrighterScript supports declaring parameters (and typecasting) to a typed array. Typed arrays can be used to specifically declare that the elements of an array are a certain type.

## Syntax

Typed arrays can be declared with the following syntax: `<type>[]`. For example, the parameter to the function below is an array of integers

```BrighterScript
function sum(values as integer[]) as integer
    total = 0
    for each value in values
        total += value
    end for
    return total
end function
```

Multidimensional arrays are supported:

```BrighterScript

function get3x3IdentityMatrix() as float[][]
    row1 = [1, 0, 0]
    row2 = [0, 1, 0]
    row3 = [0, 0, 1]
    return [row1, row, row3]
end function
```

## Transpilation

Since Brightscript does not have typed arrays, typed arrays will be transpiled as `object`, since they are programatically the same as `roArray.`

```BrighterScript
function sum(values as integer[]) as integer
    total = 0
    for each value in values
        total += value
    end for
    return total
end function
```

transpiles to

```BrighterScript
function sum(values as object) as integer
    total = 0
    for each value in values
        total += value
    end for
    return total
end function
```
