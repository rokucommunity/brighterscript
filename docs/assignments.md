# Assignments

Brighterscript allows you to declare the type of variables in the assignment, with using the `as <type>` syntax on the left hand side of the `=` (equals).

Keep in mind that this is the type as BrighterScript understands it to be. The actual type during runtime may be different. Even with this caveat, by declaring types in assignments, the risk of runtime errors because of invalid type usage is lessened.

## Example

In the following example, `data` is `dynamic` type, but we declare that `name` is of `string` type:

```brighterscript
function getUCaseName(data) as string
    name as string = data.name

    return ucase(name)
end function
```

## Validation

By declaring the type on the left hand side of the assignment, if the inferred type of the right hand side is not compatible, an error message is raised:

```brighterscript
sub assignmentValidation()
    pi as float = 3.14 ' no error: 3.14 is a float

    twoPi as integer = pi * 2 ' no error: numbers are always compatible

    boolTest as bool = "true" ' error: strings are not compatible with boolean

    data as {id as string} = {id: 1234} ' error: "id" member not compatible

    deviceInfo as string = createObject("roDeviceInfo") ' error: types not compatible
end sub
```

## Declared Type vs. Typecast

Declaring a type in an assignment is very similar to using a [typecast](./typecasts.md) on the right hand side, with one major difference: typecasts are not validated. Therefore it is safer to use declared types if possible.

Example:

```brighterscript
sub exampleTypecast()
    name = 1234 as string ' No BrighterScript error
    print ucase(name) ' Runtime error: name is an integer
end sub

sub exampleDeclaredType()
    name as string = 1234 ' BrighterScript error - types not compatible
    print ucase(name) ' Would be runtime error, but previous line caught during compilation
end sub
```

## For each loop variables

The type of a `for each` loop item can be declared as well:

```brighterscript
function sumWidthArray(widthArray) as integer
    total = 0
    for each width as integer in widthArray
       total += width ' width is an integer
    end for
    return total
end function
```

If the declared type is not compatible with the inferred type, an error will be raised. In this example, the declared item type is `integer`, but iterating over a `roAssociativeArray` will give the `string` values of the keys of the associative array:

```brighterscript
function sumWidthMap(widthMap as roAssociativeArray) as integer
    total = 0
    for each width as integer in widthMap ' error
       total += width
    end for
    return total
end function
```
