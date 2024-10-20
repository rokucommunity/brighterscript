# Typechecking without transpiling
If you want the benefits of BrighterScript's type system but don't want to use the transpiler, you can use comments to declare variable types to get much richer editor experience and type validation.

## Params
Declare the type of a specific parameter:

```brighterscript
'@param {roSGNodeRectangle} node
function resize(node, width as integer, height as string)
    'yay, we know that `node` is a `roSGNodeRectangle` type
    node.width = width
    node.height = height
end function
```

## Return type

Declare the return type of a function

```brighterscript
'@return {roSGNodeRectangle}
function createRectangle()
    return createObject("roSGNode", "Rectangle")
end function

function test()
    'yay, we know that `rectangle` is a `roSGNodeRectangle` type
    rectangle = createRectangle()
end function
```

## Inline variable type
You can override the type of a variable in brs files by starting a comment with `@type` . This will cast the variable below with the given type.

```brighterscript
' @type {integer}
runtime = getRuntimeFromServer()
```

## TODO: Function-level variable type 
Sometimes you need to declare a variable at more than one location in your code. In this situation, you can declare the variable type in the body of the function before the variable usage, and that variable will then be treated as that type.

```brighterscript
' @type {integer} runtime
if m.top.hasRuntime
    runtime = m.top.runtime
else
    runtime = 12345
end if
```
