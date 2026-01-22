# Intersection Types

BrighterScript Intersection Types are a way to define a type that combines the members of multiple types. They are similar to Intersection Types found in other languages, such as [TypeScript](https://www.typescriptlang.org/docs/handbook/2/objects.html#intersection-types).

## Syntax

Intersection types can be declared with the following syntax: `<type> and <type>`. For example, the parameter to the function below could be meets both the interfaces `HasId` and `HasUrl`:

```BrighterScript
interface HasId
    id as string
end interface

interface HasUrl
    url as string
end interface

function getUrlWithQueryId(value as HasId and HasUrl) as string
    return value.url + "?id=" + value.id
end function
```

Any number of inner types, including classes or interfaces, could be part of an intersection:

```BrighterScript
interface HasId
    id as string
end interface

interface HasUrl
    url as string
end interface

interface HasSize
    width as integer
    height as integer
end interface


function getUrlWithQuerySize(response as HasId and HasUrl and HasSize) as string
    return value.url + "?id=" + value.id + "&w=" + value.width.toStr().trim() + "&h=" + value.height.toStr().trim()
end function
```

## Members and Validation

A diagnostic error will be raised when a member is accessed that is not a member of any of the types of a union. Note also that if a member is not the same type in each of the types in the union, it will itself be considered an intersection.

```BrighterScript
sub testIntersection(value as {id as string} and {id as integer})
    ' This is an error - "value.id" is of type "string AND integer"
    printInteger(value.id)
end sub

sub printInteger(x as integer)
    print x
end sub
```

## Transpilation

Since Brightscript does not have intersection types natively, intersection types will be transpiled as `dynamic`.

```BrighterScript

interface HasRadius
    radius as float
end interface

interface Point
    x as float
    y as float
end interface

function getCircleDetails(circle as HasRadius and Point) as string
    return "Circle: radius=" + circle.radius.toStr() + ", center=" + circle.x.toStr() + "," + circle.y.toStr()
end function
```

transpiles to

```BrightScript
function getCircleDetails(circle as dynamic) as string
    return "Circle: radius=" + circle.radius.ToStr() + ", center=" + circle.x.toStr() + "," + circle.y.toStr()
end function
```
