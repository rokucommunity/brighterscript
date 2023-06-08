# Union Types

BrighterScript Union Types are a way to define a type of a variable that could be any of a set of types. They are similar to Union Types found in other languages, such as [TypeScript](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#union-types).

## Syntax

Union types can be declared with the following syntax: `<type> or <type>`. For example, the parameter to the function below could be either an `integer` or a `string`:

```BrighterScript
function makePriceString(value as string or integer)
    return "$" + value.toStr()
end function
```

Any number of inner types, including classes or interfaces, could be part of a union:

```BrighterScript
interface DataResponse
  status as number
  data as string
end interface

interface ValueResponse
  status as number
  data as number
end interface

interface Error
  status as number
  data as string
end interface


function getStatusString(response as DataResponse or ValueResponse or Error) as string
    if response.status >= 200 and response.status < 300
        return "Success"
    end if
    return "Error"
end function
```

## Validation

When the `enableTypeValidation` option flag is enabled, a diagnostic error will be raised when a member is accessed that is not a member of ALL of the types of a union.

In the example above, accessing `response.status` is fine, because it is in all of the types of the union. Accessing `response.data` would raise an error, because it's not in the `Error` interface.

## Transpilation

Since Brightscript does not have union types natively, union types will be transpiled as `dynamic`.

```BrighterScript
function makePriceString(value as string or integer)
    return "$" + value.toStr()
end function
```

transpiles to

```BrightScript
function makePriceString(value as dynamic)
    return "$" + value.toStr()
end function
```
