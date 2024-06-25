# BrighterScript
BrighterScript is a superset of Roku's BrightScript language. Its goal is to provide new functionality and enhanced syntax support to enhance the Roku channel developer experience.

See the following pages for more information:

## [Annotations](annotations.md)
```brighterscript
'mostly useful for plugins that change code based on annotations
@logOnException()
sub doSomething()
    '...
end
```

## [Callfunc Operator](callfunc-operator.md)
```brighterscript
'instead of `node.callfunc("someMethod", 1, 2, 3)`, you can do this:
node@.someMethod(1, 2, 3)
```

## [Classes](classes.md)
```brighterscript
class Movie
    public title as string
    private _actors = invalid
    public sub getActors()
        if m._actors = invalid
            m._actors = api_get_actors()
        end if
        return m._actors
    end sub
end class
```

## [Constants](constants.md)
```brighterscript
const API_URL = "https://api.acme.com/v1/"
sub main()
    print API_URL
end sub
```

## [Enums](enums.md)
```brighterscript
enum RemoteButton
    up = "up"
    down = "down"
    left = "left"
    right = "right"
end enum
```

## [Namespaces](namespaces.md)
```brighterscript
namespace util
    function toUpper(value as string)
        return
    end function
end namespace

sub main()
    print util.toUpper("hello world")
end sub
```

## [Imports](imports.md)
```brighterscript
import "pkg:/source/util.bs"
sub main()
    print util_toUpper("hello world")
end sub
```

## [Null-coalescing operator](null-coalescing-operator.md)
```brighterscript
userSettings = getSettingsFromRegistry() ?? {}
```

## [Plugins](plugins.md)
Plugins can be used to manipulate code at any point during the program lifecycle.

## [Regular Expression Literals](regex-literals.md)
```brighterscript
print /hello world/ig
```

## [Source Literals](source-literals.md)
```brighterscript
print SOURCE_FILE_PATH
print SOURCE_LINE_NUM
print FUNCTION_NAME
print SOURCE_FUNCTION_NAME
print SOURCE_LOCATION
print PKG_PATH
print PKG_LOCATION
```
## [Template Strings (Template Literals)](template-strings.md)
```brighterscript
name = `John Smith`

text = `hello ${name}`

text = `first line text
second line text`
```

## [Ternary (Conditional) Operator](ternary-operator.md)
```brighterscript
authStatus = user <> invalid ? "logged in" : "not logged in"
```

## [Typecasts](typecasts.md)
```BrighterScript
nodeId = (node as roSgNode).id
```

## [Typed Arrays](typed-arrays.md)
```brighterscript
function getY(translation as float[]) as float
    yValue = -1
    if translation.count() > 1
        yValue = translation[1] ' yValue is known to be of type float
    end if
    yValue
end function
```

## [Union Types](union-types.md)
```brighterscript
sub logData(data as string or number)
    print data.toStr()
end sub
```

## [Variable Shadowing](variable-shadowing.md)
Name resolution rules for various types of shadowing.