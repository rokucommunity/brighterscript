# Types

BrightScript already lets you declare the types of function parameters and return values, and Roku checks them when your code runs. BrighterScript builds on that. You can use your own classes, interfaces and enums as types, along with the names of Roku's built-in components, and the compiler checks those names before your code ever reaches a device. When you build, each type is converted to one that the Roku runtime understands.

## Using your own types

In `.bs` files, you can use the name of a [class](classes.md), [interface](interfaces.md) or [enum](enums.md) anywhere you can use a built-in type. Here, `quality` is typed as an enum, and the function returns an object described by an interface:

```brighterscript
function createStream(url as string, quality as Quality) as VideoStream
    return {
        url: url
        quality: quality
    }
end function

enum Quality
    sd = "sd"
    hd = "hd"
end enum

interface VideoStream
    url as string
    quality as Quality
end interface
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
function createStream(url as string, quality as object) as object
    return {
        url: url
        quality: quality
    }
end function
```

</details>

The device only knows BrightScript's built-in types. Built-in types like `string` are left as they are, and `Quality` and `VideoStream` become `object`. Before transpiling, the compiler uses the original names to check your code, as described in [What the compiler checks](#what-the-compiler-checks).

Types declared inside a [namespace](namespaces.md) are referenced by their full name:

```brighterscript
namespace catalog
    class Movie
        title as string
    end class
end namespace

sub printTitle(movie as catalog.Movie)
    print movie.title
end sub
```

## Built-in types

These types are part of BrightScript itself. They work in both `.brs` and `.bs` files, and they are left unchanged in the transpiled code, so the device checks them at runtime.

| Type | Description |
|---|---|
| `boolean` | `true` or `false` |
| `integer` | A 32-bit whole number |
| `longinteger` | A 64-bit whole number |
| `float` | A single-precision decimal number |
| `double` | A double-precision decimal number |
| `string` | Text |
| `object` | Any BrightScript object, such as an associative array, array or node |
| `function` | A reference to a function |
| `dynamic` | Any value |
| `void` | No value. Only valid as a return type |

## Roku component types

You can also use the name of any built-in Roku component or interface as a type, such as `roAssociativeArray`, `roSGNode`, `roDateTime` or `ifArray`. Roku's SceneGraph node types work as well, by adding the `roSGNode` prefix to the node's name:

```brighterscript
sub populateList(list as roSGNodeLabelList, items as roArray)
    content = createObject("roSGNode", "ContentNode")
    for each item in items
        content.createChild("ContentNode").title = item
    end for
    list.content = content
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub populateList(list as object, items as object)
    content = createObject("roSGNode", "ContentNode")
    for each item in items
        content.createChild("ContentNode").title = item
    end for
    list.content = content
end sub
```

</details>

Like your own types, these become `object` in the transpiled code. They make your function signatures easier to read, and they tell other developers what a function expects.

## Class fields and interface members

Class fields and interface members use the same `as` syntax:

```brighterscript
class Episode
    title as string
    seasonNumber as integer
    durationInSeconds as integer = 0
    series as Series
end class

interface Series
    title as string
    optional rating as string
end interface
```

Interfaces only exist at compile time and are removed from the transpiled code. The types of class fields are removed too. Each field is initialized to its default value, or to `invalid` if it doesn't have one. See [Classes](classes.md#property-initialization) for details.

## What the compiler checks

When you build your project, BrighterScript checks the following.

**Every type name refers to something that exists.** A misspelled or missing type is reported where you wrote it:

```brighterscript
sub play(item as MediaItme)
end sub
```

```
error BS1044: Function parameter 'item' is of invalid type 'MediaItme'
```

The same check applies to return types (BS1037) and class field types (BS1123). The type must be a built-in type, a Roku component, or a class, interface or enum that the file can see. A type declared in another file is available when that file is part of the same scope, through an [import](imports.md) or a `<script>` tag, the same way functions are.

**Return statements match the return type.** A `sub`, or a function declared `as void`, can't return a value. A function with any other declared return type must return one:

```brighterscript
function getTitle() as string
    return
end function
```

```
error BS1142: Non-void function must return a value
```

**Calls have the right number of arguments.** Calling a function with too few or too many arguments is an error (BS1002). Optional parameters, the ones with default values, can be left out.

**Overridden fields keep a compatible type.** If a child class declares a field that is already declared in a parent class, its type must be assignable to the parent's type:

```brighterscript
class Animal
    name as string
end class

class Dog extends Animal
    name as integer
end class
```

```
error BS1098: Field 'name' in class 'Dog' is not assignable to the same field in base class 'Animal'. Type 'integer' is not assignable to type 'string'.
```

### What isn't checked

This version of BrighterScript doesn't check the types of values. It doesn't verify that the arguments you pass match the parameter types, and it doesn't verify that the members you access exist on a typed value. For example, this compiles without errors:

```brighterscript
sub setVolume(level as integer)
end sub

sub main()
    setVolume("loud")
end sub
```

For built-in types like `integer`, the device catches the mismatch at runtime with a type mismatch error. Your own types become `object` in the transpiled code, so the device can only tell that the value is an object, not which class or interface it matches.

BrighterScript v1 checks the types of values. See [Preparing for v1](#preparing-for-v1).

## Types in the transpiled code

This table shows what each kind of type becomes when your code is transpiled:

| You write | Transpiled code |
|---|---|
| A built-in type, such as `integer` or `string` | Unchanged |
| A class, interface or enum | `object` |
| A Roku component, such as `roAssociativeArray` | `object` |
| A class field or interface member type | Removed |

If you want to remove every parameter and return type from the transpiled code, set [`removeParameterTypes`](../tooling/bsconfig.md#removeparametertypes) to `true` in your `bsconfig.json`.

## Preparing for v1

[BrighterScript v1](https://rokucommunity.github.io/brighterscript/v1/) has a full type system. It infers the type of every expression, checks values against the types you declare, and uses those types for completions and hover information in your editor.

Most of v1's type syntax has been added to this version as well, so you can start using it before you upgrade. This version accepts the syntax but doesn't add the functionality behind it. It parses the types, doesn't check them, and removes them or replaces them with `dynamic` when you build. That lets you move your code to the v1 syntax a file at a time while you keep building with v0. You don't need a long-lived upgrade branch, and the transpiled code behaves the same as before.

| Syntax | Example | What v0 does | Learn more |
|---|---|---|---|
| Typed arrays | `titles as string[]` | Becomes `dynamic` | [Typed arrays](https://rokucommunity.github.io/brighterscript/v1/language-features/typed-arrays) |
| Union types | `id as string or integer` | Becomes `dynamic` | [Union types](https://rokucommunity.github.io/brighterscript/v1/language-features/union-types) |
| Intersection types | `item as HasId and HasUrl` | Becomes `dynamic` | [Intersection types](https://rokucommunity.github.io/brighterscript/v1/language-features/intersection-types) |
| Inline interfaces | `options as { name as string }` | Becomes `dynamic` | [Inline interfaces](https://rokucommunity.github.io/brighterscript/v1/language-features/interfaces#inline-interfaces) |
| Function types | `onDone as function(success as boolean) as void` | Becomes `Function` | [Function types](https://rokucommunity.github.io/brighterscript/v1/language-features/function-types) |
| Type statements | `type Id = string or integer` | Removed | [Type statements](https://rokucommunity.github.io/brighterscript/v1/language-features/type-statements) |
| Typed variables | `count as integer = 0` | Type removed | [Assignments](https://rokucommunity.github.io/brighterscript/v1/language-features/assignments) |
| Typed `for each` variables | `for each width as integer in widths` | Type removed | [For each loop variables](https://rokucommunity.github.io/brighterscript/v1/language-features/assignments#for-each-loop-variables) |
| Inline typecasts | `(node as roSGNode).id` | Cast removed | [Inline typecasts](https://rokucommunity.github.io/brighterscript/v1/language-features/typecasts#inline-typecasts) |
| Typecast statements | `typecast m as WidgetScope` | Removed | [Typecast statements](https://rokucommunity.github.io/brighterscript/v1/language-features/typecasts#typecast-statements) |

Keep these limitations in mind while you migrate:

- **The names inside these types aren't validated.** For example, `item as Movie or Episode` compiles even if neither `Movie` nor `Episode` exists. Errors like that will appear when you switch to v1.
- **Typecasts have no effect.** v0 doesn't use them for validation or editor features. They're removed from the transpiled code.
- **A type statement's name becomes `object`.** A parameter or return value declared with a name from a `type` statement is transpiled as `object`, the same as a class or interface, even when the type statement names a built-in type like `string`.
- **`alias` statements are parsed but not resolved.** v0 accepts `alias get2 = get`, but using `get2` in your code reports `Cannot find name 'get2'`. Wait until you're on v1 to use [aliases](https://rokucommunity.github.io/brighterscript/v1/language-features/variable-shadowing#aliasing-shadowed-names).
- **Expect new errors after you upgrade.** v1 checks the types of values, so code like `setVolume("loud")` from [What isn't checked](#what-isnt-checked) compiles in v0 but reports an error in v1.
