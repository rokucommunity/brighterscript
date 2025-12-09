## Type Statements

BrighterScript supports declaring custom named types using the `type` keyword. In this way, new types can be created as wrappers, or aliases for other types. This is useful to create custom names for advanced types like unions, so they can be more easily used throughout the code.

## Syntax

To create a new custom named types, use the syntax `type <customName> = <existingType>` at either the top level of a file, or within a namespace.

For example, if you wanted to create a shorthand for the union type `integer or float or double`, you could do the following:

```BrighterScript
type number = integer or float or double

function sum(x as number, y as number) as number
    return x + y
end function

function product(x as number, y as number) as number
    return x * y
end function
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function sum(x as dynamic, y as dynamic) as dynamic
    return x + y
end function

function product(x as dynamic, y as dynamic) as dynamic
    return x * y
end function
```

</details>

## Importing

Types created with the `type` keyword are available through importing the file they are declared in.

For example:

**src/components/Widget.bs**

```BrighterScript
namespace Widgets

    type widget = Button or Checkbox

    interface Button
        text as string
        action as function
    end interface

    interface Checkbox
        text as string
        checked as boolean
    end interface
end namespace
```

**src/components/UI.bs**

```BrighterScript
import "pkg:/components/Widget.bs" ' provides the "Widgets.widget" type

function getName(w as Widgets.widget) as string
    return w.text
end function
```
