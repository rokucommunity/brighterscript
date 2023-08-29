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

## Member Methods and Validation

The type of the array changes some of the validation on built-in array member methods, such as `push()` and `pop()` so they will expect the array's type as argument, in the case of `push()`, or will return the array's type, for methods such as `pop()`.

For example, this code will cause some validation errors:

```BrighterScript
sub doWork(values as integer[])
    print lcase(values.pop()) ' Validation error: lcase() expects a string, but values.pop() returns an integer
    result = "Hello world"
    values.push(result) ' Validation error: values.push() expects an integer argument
end sub
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
