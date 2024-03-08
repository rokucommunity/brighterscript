# Variable Shadowing and Name Collisions in BrighterScript

BrighterScript allows various kinds of [variable name shadowing](https://en.wikipedia.org/wiki/Variable_shadowing). In general, variables and types refer to items defined in the current scope/namespace if available.

However, due to the limitations of BrightScript, there are some name collisions that lead to unpredictable behavior, and so they cause diagnostic errors.

## Name Resolution Rules

**1. Local variables CAN shadow names of global functions.**

✅

```brighterscipt
sub test()
    log = "value" ' identifier shadows global function log() - no error
    upTime = 0 ' identifier shadows global function Uptime() - no error
end sub
```

**2. Local variables CANNOT shadow names of functions or classes defined at the same scope.**

❌

```brighterscipt
sub test()
    pi = "Apple" ' identifier shadows function pi() - causes validation error
    data = 1234 ' identifier shadows class Data - causes validation error
end sub

function pi() as float
    return 3.14
function

class Data
    value = {}
end class
```

**3. Custom types and definitions (enums, classes, interfaces, functions, consts) CANNOT have the same name if they are in the same namespace.**

❌

```brighterscipt
function someName()
end function

class SomeName  ' class shadows local function - causes validation error
    sub foo()
    end sub
end class

namespace alpha
    class OtherName  ' class in namespace shadows function in same namespace - causes validation error
        sub foo()
        end sub
    end class

    function otherName()
    end function
end namespace
```

**4. Functions and classes outside of namespaces CANNOT shadow standard global functions (eg. `ParseJson`, `LCase`, etc.)**

❌

```brighterscipt
class log  ' class shadows global function - causes validation error
    sub foo()
    end sub
end class


```

**5. Definitions inside namespaces CAN shadow standard global functions, or functions at a difference namespace-level. In this way, the outer item is unavailable, and only the item defined at the current scope is accessible.**

✅

```brighterscipt
class SomeName()
end class

namespace alpha
    class SomeName  ' class in namespace shadows function in upper scope
        sub foo()
            print "foo"
        end sub
    end class

    sub test()
        myKlass = new SomeName() ' refers to alpha.SomeName
        myKlass.foo() ' will print "foo"
    end sub

    sub log(data) ' function defined as alpha.log - this is ok
        print "LOG: ";data
    end sub

    sub foo()
        log("Hello world") ' refers to alpha.log - will print "LOG: Hello world"
    end sub
end namespace
```
