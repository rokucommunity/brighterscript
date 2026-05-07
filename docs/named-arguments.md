# Named Arguments

BrighterScript supports calling functions with named arguments, allowing you to pass arguments by parameter name instead of by position.

## Basic Usage

Use `paramName: value` syntax inside a function call:

```brighterscript
sub greet(name as string, excited as boolean)
    if excited
        print "Hello, " + name + "!!!"
    else
        print "Hello, " + name
    end if
end sub

sub main()
    greet(name: "Bob", excited: true)
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub greet(name as string, excited as boolean)
    if excited
        print "Hello, " + name + "!!!"
    else
        print "Hello, " + name
    end if
end sub

sub main()
    greet("Bob", true)
end sub
```

</details>

## Supported Call Sites

Named arguments are supported for regular functions, namespace functions, and class constructors:

```brighterscript
namespace MyNs
    sub greet(name as string, excited as boolean)
    end sub
end namespace

class Point
    function new(x as integer, y as integer)
    end function
end class

sub main()
    MyNs.greet(name: "Bob", excited: true)
    p = new Point(x: 1, y: 2)
end sub
```

## Out-of-Order Arguments

Named arguments must be passed in the same order as the function declaration. Calling a function with named arguments out of declaration order is a compile-time error:

```brighterscript
sub createUser(name as string, age as integer, admin as boolean)
end sub

sub main()
    ' error: Named argument 'name' is out of order
    createUser(admin: false, name: "Alice", age: 30)
end sub
```

### Quick fix

In editors with BrighterScript language support, a `Reorder named arguments to match function declaration` quick fix is offered for this diagnostic. Applying it rewrites the call to match the function signature:

```brighterscript
sub createUser(name as string, age as integer, admin as boolean)
end sub

sub main()
    createUser(name: "Alice", age: 30, admin: false)
end sub
```

## Mixed Positional and Named Arguments

Positional arguments can be combined with named arguments. Positional arguments must come first:

```brighterscript
sub greet(name as string, title as string, excited as boolean)
end sub

sub main()
    greet("Bob", excited: true, title: "Mr")
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub greet(name as string, title as string, excited as boolean)
end sub

sub main()
    greet("Bob", "Mr", true)
end sub
```

</details>

## Skipping Optional Parameters

Named arguments let you skip optional middle parameters. BrighterScript inserts the default value for any skipped parameter:

```brighterscript
sub greet(name as string, title = "Mr", excited = false)
end sub

sub main()
    ' Skip "title", pass "excited" by name
    greet(name: "Bob", excited: true)
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub greet(name as string, title = "Mr", excited = false)
end sub

sub main()
    ' Skip "title", pass "excited" by name
    greet("Bob", "Mr", true)
end sub
```

</details>

If a skipped optional parameter has no default value, `invalid` is inserted:

```brighterscript
sub greet(name as string, title = invalid, excited = false)
end sub

sub main()
    greet(name: "Bob", excited: true)
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub greet(name as string, title = invalid, excited = false)
end sub

sub main()
    greet("Bob", invalid, true)
end sub
```

</details>

## Validation

BrighterScript validates named argument calls and reports the following errors:

### Unknown argument name

```brighterscript
sub greet(name as string)
end sub

greet(nope: "Bob") ' error: Unknown named argument 'nope' for function 'greet'
```

### Duplicate named argument

```brighterscript
greet(name: "Bob", name: "Alice") ' error: Named argument 'name' was already provided
```

### Positional argument after named argument

```brighterscript
greet(name: "Bob", true) ' error: Positional arguments cannot follow named arguments
```

### Named arguments on an unknown function

Named arguments require the function definition to be visible so BrighterScript can verify parameter names at compile time:

```brighterscript
unknownFunc(param: true) ' error: Cannot use named arguments when calling 'unknownFunc' because the function definition cannot be found
```

### Cross-scope parameter conflict

When a `.bs` file is shared across multiple component scopes and the same function name resolves to different parameter signatures in those scopes, named arguments cannot be safely transpiled (the same call site would need different positional output per scope). BrighterScript reports this as an error:

```brighterscript
' shared.bs (included by both CompA.xml and CompB.xml)
sub callFoo()
    ' error: Named arguments for 'foo' are ambiguous: the function has different
    ' parameter signatures across component scopes that share this file.
    foo(a: 2, b: 1)
end sub
```

```brighterscript
' helperA.bs (included by CompA.xml)
sub foo(a, b)
end sub
```

```brighterscript
' helperB.bs (included by CompB.xml)
sub foo(b, a)
end sub
```

To resolve, give the conflicting functions distinct names or align their parameter order across scopes.

## BrighterScript Only

Named argument syntax is a BrighterScript feature and is not valid in plain BrightScript (`.brs`) files.
