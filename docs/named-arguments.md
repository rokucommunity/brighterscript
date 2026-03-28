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

## Out-of-Order Arguments

Named arguments can be passed in any order — BrighterScript reorders them to match the function definition at compile time:

```brighterscript
sub createUser(name as string, age as integer, admin as boolean)
end sub

sub main()
    createUser(admin: false, name: "Alice", age: 30)
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub createUser(name as string, age as integer, admin as boolean)
end sub

sub main()
    createUser("Alice", 30, false)
end sub
```

</details>

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

Named arguments require the function definition to be visible so BrighterScript can verify parameter names and reorder arguments at compile time:

```brighterscript
unknownFunc(param: true) ' error: Cannot use named arguments when calling 'unknownFunc' because the function definition cannot be found
```

## BrighterScript Only

Named argument syntax is a BrighterScript feature and is not valid in plain BrightScript (`.brs`) files.
