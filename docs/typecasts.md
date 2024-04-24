# BrighterScript Typecasts

In BrighterScript, the inferred types of expressions can be explicitly changed through typecasts.

There are two ways of doing this - through inline typecasts, or through typecast statements.

Any expressions that has been typecast will be assumed to be that type.

## Inline typecasts

To invoke an inline typecast, use the `as <type>` syntax after an expression. The whole typecast can also be enclosed in parentheses as well.

In this example, the `node` parameter is `dynamic`, but is cast to the built-in type `roSgNode`. `roSgNode` has an `id` property that is a `string`.
Due to the assignment, `nodeId` is also known to be a string.

Because of the typecast, the intellisense code completion also knows the type, so at the `.` after the typecast, members of `roSgNode` will be suggested.

Example:

```BrighterScript
function getPrefixedId(node, prefix as string) as string
    nodeId = (node as roSgNode).id
    return prefix + nodeId
end function
```

## Typecast Statments

In order to specify all usages of an expression are explicity set to a certian type, you can use a `typecast` statement.

Syntax:

`typecast m as <type>`

Rules:

- `Typecast` statements are only allowed at the top of files (along with `import` and `library` statements), and as the first statement in a function or namespace.
- There can be a maximum of one `typecast` statement per block
- Only runtime symbols can be typecast
- Currently only `m` is supported

This is very usefuly for components, so that the actual type of Associative Array `m` can narrowed to provide better validation.

**pkg:/components/Widget.xml**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="Widget" extends="Group">
    <script uri="Widget.bs" />
    <script uri="Widget.interface.bs" />
    <interface>
        <field id="enabled" type="boolean" value="false" />
        <field id="state" type="string" />
    </interface>
    <children>
        <label id="myLabel" />
    </children>
</component>
```

**pkg:/components/Widget.interface.xml**

```BrighterScript
interface WidgetObject
    top as roSgNodeWidget
    label as roSgNodeLabel
    value as string
end interface
```

**pkg:/components/Widget.bs**

```BrighterScript
typecast m as WidgetObject

sub init
    m.label = m.top.findNode("myLabel")
    m.value = "Test"
    m.top.state = "ok"
    printDetails()
end sub

sub printDetails()
    ' all members of `m` are known
    print m.top.subtype()
    print m.label.text
    print m.top.state
end sub
```

`Typecast` statements are also useful in inline functions to explicity set the type of `m`:

```BrighterScript
interface Greeter
    greeting as string
    name as string
    function doGreeting() as string
end iterface

function createGreater(name as string) as Greeter
    myGreeter = {
        greeting: "Hello"
        name: name
        doGreeting: function () as string
            typecast m as Greeter
            return `${m.greeting} ${m.name} ' m is explicity set to be of type Greeter
        end function
    }
    retrun myGreeter
end function
```
