# BrighterScript Namespaces

BrighterScript provides a means of grouping functions and classes into Namespaces. BrightScript has no support for namespaces. Generally Roku developers will simulate namespaces by using underscores. However, that causes a large amount of clutter for the intellisense results.

## Basic function example
```BrighterScript
namespace Vertibrates.Birds
    function GetDucks()
    end function
end namespace
sub main()
    Vertibrates.Birds.GetDucks()
end sub
```

transpiles to

```BrightScript
function Vertibrates_Birds_GetDucks()
end function

sub main()
    Vertibrates_Birds_GetDucks()
end sub
```

As you can see, behind the scenes, BrighterScript will convert all periods found within namespace names into underscores so that it will be compatible with regular BrightScript.

## Classes
Namespaces can also contain classes. See the [classes](classes.md#Namespaces) for more detailed information.

## Namespace inference
Functions and classes within a namespace do not need to be prefixed with the full namespace name when called from another location in the same namespace. For example,

```
namespace Vertibrates.Birds
    function GetAllBirds()
        return [
            GetDuck(),
            GetGoose()
        ]
    end function

    function GetDuck()
    end function

    function GetGoose()
    end function
end namespace
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function Vertibrates_Birds_GetAllBirds()
    return [
        Vertibrates_Birds_GetDuck(),
        Vertibrates_Birds_GetGoose()
    ]
end function

function Vertibrates_Birds_GetDuck()
end function

function Vertibrates_Birds_GetGoose()
end function
```
</details>

Notice how we didn't need to specify `Vertibrates.Birds` in front of `GetDuck()` and `GetGoose()`. That's because the compiler is smart enough to recognize where those functions come from.

## Works in assignments as well
The compiler is smart enough to recognize namespaces in assignments as well.

```BrighterScript
namespace Vertibrates.Birds
    sub Quack()
    end sub

    sub Waddle()
    end sub

    sub Live()
        'assign based on fully-qualified namespace name
        speak = Vertibrates.Birds.Quack

        'infer Current namespace
        walk = Waddle
    end sub
end namespace
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub Vertibrates_Birds_Quack()
end sub

sub Vertibrates_Birds_Waddle()
end sub

sub Vertibrates_Birds_Live()
    'assign based on fully-qualified namespace name
    speak = Vertibrates_Birds_Quack
    'infer Current namespace
    walk = Vertibrates_Birds_Waddle
end sub
```
</details>

## Sharing name of namespaced item and non-namespaced item is prohibited
The compiler will throw an error whenever it encounters a namespaced function with the same name as a global function. The same rule applies to classes.

```BrighterScript
sub Quack()
end sub
namespace Vertibrates.Birds
    sub Quack() ' this will result in a compile error.
    end sub
end namespace
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub Quack()
end sub
sub Vertibrates_Birds_Quack() ' this will result in a compile error.
end sub
```
</details>

## Nesting namespaces

In the above examples, nested namespaces are formed by specifying a _dotted identifier_ (`NameA.NameB`). You can also declare namespaces within other namespaces to form a dotted namespace identifier which contains its parent namespaces.

```BrighterScript
namespace Vertibrates
    namespace Birds
        sub Quack()
        end sub
    end namespace

    namespace Reptiles
        sub Hiss()
        end sub
    end
end namespace
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub Vertibrates_Birds_Quack()
end sub
sub Vertibrates_Reptiles_Hiss()
end sub
```
</details>
