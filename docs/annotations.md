# BrighterScript Annotations

Annotations are metadata you can attach to any statement, though more often to functions or classes. This extra information will be available to [plugins](plugins.md) walking the AST of the code.

> Annotations completely disappear when transpiled to BrightScript, and are not available at run time.

## Syntax

Annotations should precede a statement, either on a previous line, or inline separated by whitespace.
A statement can have multiple annotations.

The name of the annotation should be a valid identifier and can not be a keyword (e.g. `for`, `while`, `else`...).

Annotations can have parameters - these parameters should be a list of valid BrighterScript expressions separated by commas.

```
@<annotation_name>[(parameters)]
[more annotations]
<statement>

@<annotation_name>[(parameters)] [more annotations] <statement>
```

## Examples

```brighterscript

@expose
class MyComp
end class

@task @export_fields([content, result])
function init()
end function

@configure(
    "value",
    42,
    true,
    {
        hello: "world",
        scene: "MainScene"
    }
)
function main()
end
```
transpiles to

```brightscript
function __MyComp_builder()
    instance = {}
    instance.new = sub()
    end sub
    return instance
end function
function MyComp()
    instance = __MyComp_builder()
    instance.new()
    return instance
end function

function init()
end function

function main()
end
```

Notice the annotations were completely removed (because annotations are not available at runtime).

## Plugin usage

Annotation are parsed and stored in the AST as "expressions" and attached to the statement following their declaration.

```typescript
class Statement {
    ...
    annotations: AnnotationExpression[];
    ...
}
```

Usage:

```typescript
const main: FunctionStatement = pluginFindMainFunction();
if (main.annotations) {
    main.annotations.forEach(a => {
        if (a.name === 'configure') {
            const args = a.getArguments();
            // ['value', 42, true, { hello: 'world', scene: 'MainScene' }]
        }
    });
}
```
