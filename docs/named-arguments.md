# Named arguments
Named arguments allow you to match an argument to its position in the function parameter list by name.

**NOTE:** Named arguments are not currently supported for function calls within complex expressions such as ternary, null coalescence, etc. This may change in the future as the compiler improves.

## Simple usage
For simple functions, the usage is straightforward. Simply prefix the value with the parmaeter name and a colon.
```vb
sub Greet(message as string, name as string)
    print message + " " + name
end sub

sub main()
    'normal call
    Greet("Hello", "Alice")

    'named argument call with params in same order
    Greet(message: "Hello", name: "Brian")

    'named argument call with params out of order
    Greet(name: "Clarice", message: "Hello")
end sub
```

transpiles to:

```vb
sub Greet(message as string, name as string)
    print message + " " + name
end sub

sub main()
    'normal call
    Greet("Hello", "Alice")

    'named argument call with params in same order
    Greet("Hello", "Brian")

    'named argument call with params out of order
    Greet("Hello", "Clarice")
end sub
```

## Named arguments after ordered parameters
Named arguments can come after ordered parameters. Once named parameters are defined, all further parameters must also be named.

In this example, notice how the first two params are ordered, while the rest are named:
```vb
sub main()
    add(1, 2, four: 4, three: 3)
end sub
sub add(first, second, third, fourth)
    return one + two + three + four
end sub
```

transpiles to:
```vb
sub main()
    'first two params are ordered, the rest are named
    add(1, 2, 3, 4)
end sub
sub add(first, second, third, fourth)
    return one + two + three + four
end sub
```

## Optional parameters
### Default values
The BrightScript runtime is sensitive to type mismatches, we can't simply pass `invalid` for any unspecified optional named arguments. Instead, we need to lift the values out to the call site. For any unspecified optional parameters, the compiler looks at the default value of each argument and inlines them to the function call.

Consider the following example:

```vb
sub main()
    add(third: 75, first: 25)
end sub

sub add(first = 1 as integer, second = 2 as integer, third = 3 as integer)
    return one + two + three
end sub
```

transpiles to:

```vb
sub main()
    add(25, 2, 75)
end sub

sub add(first = 1 as integer, second = 2 as integer, third = 3 as integer)
    return one + two + three
end sub
```


## Argument order matters
With named arguments, the functions are called in the order they are defined. The compiler lifts any non-primitive values out of the function call to ensure the proper execution order is maintained.


## Simple Use case
```vb
sub main()
    BuildFullName(lastName: getLastName(), firstName: getFirstName())
end sub

function BuildFullName(firstName, lastName)
    return firstName + " " + lastName
end function
```

transpiles to:
```vb
sub main()
    __bscNamedArg1_lastName = getLastName()
    __bscNamedArg2_firstName = getLastName()
    BuildFullName(__bscNamedArg2_firstName, __bscNamedArg1_lastName)
end sub

function BuildFullName(firstName, lastName)
    return firstName + " " + lastName
end function
```

### Complex use case
```vb
sub main()
    print Concat(
        text2: LCase("Alpha"),
        text1: Concat(text2: LCase("Charlie"), text1: LCase("Beta"))
    )
end sub

function concat(text1, text2)
    return text1 + text2
end function
```

transpiles to:

```vb
sub main()
    __bscNamedArg1_text2 = LCase("Alpha")
    __bscNamedArg2_text2 = LCase("Charlie")
    __bscNamedArg3_text1 = LCase("Beta")

    print Concat(
        Concat(
            __bscNamedArg3_text1,
            __bscNamedArg2_text2
        ),
        __bscNamedArg1_text2
    )
end sub

function concat(text1, text2)
    return text1 + text2
end function
```

