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
sub test(bob as dynamic)
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
sub walkThePuppy(puppy as dynamic) as dynamic
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
sub test(bob as dynamic)
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
