# Interfaces
Interfaces are a way to describe properties and methods on an object.

## Simple example
Interfaces can have both properties and methods.

```BrighterScript
interface Person
    name as string
    function getName() as string
end interface

sub test(bob as Person)
    print bob.name, bob.getName()
end sub
```

transpiles to

```BrightScript
sub test(bob as object)
    print bob.name, bob.getName()
end sub
```

## Use in functions
Interfaces can be used as function parameter types and return types. These types will be converted into `dynamic` when the project is transpiled.
```brighterscript
interface Dog
    name as string
    function walk()
end interface

sub walkThePuppy(puppy as Dog) as Dog
    puppy.walk()
    return puppy
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub walkThePuppy(puppy as object) as object
    puppy.walk()
    return puppy
end sub
```
</details>

## Namespaces
Interfaces can also be defined inside namespaces

```BrighterScript
namespace humanoids
    interface Person
        name as string
        function getName() as string
    end interface
end namespace

sub test(bob as humanoids.Person)
    print bob.name, bob.getName()
end sub
```

transpiles to

```BrightScript
sub test(bob as object)
    print bob.name, bob.getName()
end sub
```

## Advanced types
Interface member types can be defined as any valid brighterscript type, and even reference themselves.
```brighterscript
interface Dog
    owner as Human
end interface

interface Human
    pet as Dog
    mother as Human
end interface
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript

```
</details>

</details>

## Methods
Interfaces can describe complex methods as well
```brighterscript
interface Dog
    sub barkAt(nemesis as Cat)
end interface
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript

```
</details>

## Optional members

Interfaces can include optional members. Optional members are denoted with the keyword `optional` before the name of fields, or before the `function` or `sub` keyword for methods. Interfaces with optional members will not incur a validation diagnostic if an object that is missing that member is passed to it, yet optional members will be included in completion results, and if referenced, they are inferred to be their declared type.

```brighterscript
interface Video
    url as string
    length as float
    optional subtitleUrl as string
    optional rating as string
    optional genre as string[]
end interface
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript

```

</details>
