# Function Types

BrighterScript allows specific definitions of functions that are passed as parameters. This enables code with callbacks to fully type-checked, and for any return types of callbacks to be propagated through the code.

## Syntax

Function types support the same syntax as anonymous function definitions: parameter names, optional parameters, and parameter and return types.

```brighterscript
sub useCallBack(callback as function(name as string, num as integer) as string)
    print "Result is: " + callback("hello", 7)
end sub
```

transpiles to

```BrightScript
sub useCallBack(callback as function)
    print "Result is: " + callback("hello", 7)
end sub
```

## Use with Type Statements

Including full function signatures inside another function signature can be a bit verbose. Function types can be used in type statements to make a shorthand for easier reading.

```brighterscript
type TextChangeHandler = function(oldName as string, newName as string) as boolean

sub checkText(callback as TextChangeHandler)
    if callback(m.oldName, m.newName)
        print "Text Change OK"
    end if
end sub
```

transpiles to

```BrightScript
sub checkText(callback as function)
    if callback(m.oldName, m.newName)
        print "Text Change OK"
    end if
end sub
```

## Validation

Both the function type itself and the arguments when it is called and return values are validated.

Validating the function type:

```brighterscript
sub useCallback(callback as sub(input as string))
    callback("hello")
end sub

sub testCallback()
    ' This is a validation error: "sub(input as integer)" is NOT compatible with "sub(input as string)"
    useCallback(sub(input as integer)
        print input + 1
    end sub)
end sub
```

Validating the function call:

```brighterscript
sub useCallback(callback as sub(input as string))
    ' This is a validation error: "integer" is NOT compatible with "string"
    callback(123)
end sub
```
