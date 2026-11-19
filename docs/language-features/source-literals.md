# Source Literals

BrightScript provides the `LINE_NUM` literal, which represents the runtime 1-based line number of the current line of code. In a similar fashion, BrighterScript provides several more source literals.

These source literals are converted into inline variables at transpile-time, so keep in mind that any post-processing to the transpiled files could  cause these values to be incorrect.

## SOURCE_FILE_PATH
The absolute path to the source file, including a leading `file:/` scheme indicator. i.e. `"file:/C:/projects/RokuApp/source/main.bs"`.

```vb
print SOURCE_FILE_PATH
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
print "file" + ":///C:/projects/RokuApp/source/main.bs"
```

</details>

_note: the literal is concatenated to keep the roku static analysis tool happy_

## SOURCE_LINE_NUM
The 1-based line number of the source file.

```BrighterScript
'I am line 1
print SOURCE_LINE_NUM 'I am line 2
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
'I am line 1
print 2 'I am line 2
```

</details>

## FUNCTION_NAME
### Basic
The name of the current function
```BrighterScript
function RunFromZombie()
    print FUNCTION_NAME
end function
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function RunFromZombie()
    print "RunFromZombie"
end function
```

</details>

### Namespaced
if the function is contained in a namespace, that name will be included in the function name
```BrighterScript
namespace Human.Versus.Zombie
    function RunFromZombie()
        print FUNCTION_NAME
    end function
end namespace
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function Human_Versus_Zombie_RunFromZombie()
    print "Human_Versus_Zombie_RunFromZombie"
end function
```

</details>

### Anonymous Functions
For anonymous functions, FUNCTION_NAME will include the enclosing function name, followed by `anon` and the index of the function in its parent. If there are multiple nested anonymous functions, each level will have its own `anon[index]` in the name. Function indexes start at 0 within each enclosing function.

```BrighterScript
function main()
    zombieAttack = function()
        print FUNCTION_NAME
    end function

    humanAttack = function()
        useSword = function()
            print FUNCTION_NAME
        end function
        useSword()
    end function
end function
namespace Human.Versus.Zombie
    function Eat()
        print SOURCE_FUNCTION_NAME
        findFood = function()
            print FUNCTION_NAME
        end function
    end function
end namespace
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function main()
    zombieAttack = function()
        print "main$anon0"
    end function
    humanAttack = function()
        useSword = function()
            print "main$anon1$anon0"
        end function
        useSword()
    end function
end function
function Human_Versus_Zombie_Eat()
    print "Human.Versus.Zombie.Eat"
    findFood = function()
        print "Human_Versus_Zombie_Eat$anon0"
    end function
end function
```

</details>

## SOURCE_FUNCTION_NAME
This works the same as FUNCTION_NAME except that it will use a dot in namespace names instead of the transpiled underscores.


```BrighterScript
namespace Human.Versus.Zombie
    function Eat()
        print SOURCE_FUNCTION_NAME
        findFood = function()
            print SOURCE_FUNCTION_NAME
        end function
    end function
end namespace
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function Human_Versus_Zombie_Eat()
    print "Human.Versus.Zombie.Eat"
    findFood = function()
        print "Human.Versus.Zombie.Eat$anon0"
    end function
end function
```

</details>

## SOURCE_NAMESPACE_NAME

This works the same as SOURCE_FUNCTION_NAME except that it does not include the function name.

The SOURCE_NAMESPACE_NAME can be a useful string for debug logs and logging filters.

```BrighterScript
namespace Human.Versus.Zombie
    function Eat()
        print SOURCE_NAMESPACE_NAME
    end function
end namespace
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function Human_Versus_Zombie_Eat()
    print "Human.Versus.Zombie"
end function
```

</details>

## SOURCE_NAMESPACE_ROOT_NAME

This works the same as SOURCE_NAMESPACE_NAME except that it only includes the lowest-level namespace.

The SOURCE_NAMESPACE_ROOT_NAME can be a useful string for debug logs and logging filters.

```BrighterScript
namespace Human.Versus.Zombie
    function Eat()
        print SOURCE_NAMESPACE_ROOT_NAME
    end function
end namespace
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function Human_Versus_Zombie_Eat()
    print "Human"
end function
```

</details>

## SOURCE_LOCATION
A combination of SOURCE_FILE_PATH and SOURCE_LINE_NUM.

```vb
function main()
    print SOURCE_LOCATION
end function
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
function main()
    print "file" + ":///C:/projects/RokuApp/source/main.bs:2"
end function
```

</details>

_note: the literal is concatenated to keep the roku static analysis tool happy_


## PKG_PATH
The pkg path of the file.

```BrighterScript
function main()
    print PKG_PATH
end function
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
function main()
    print "pkg:/source/main.brs"
end function
```

</details>

## PKG_LOCATION
A combination of PKG_PATH and LINE_NUM. Keep in mind, LINE_NUM is a runtime variable provided by Roku.
```BrighterScript
print PKG_LOCATION
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
print "pkg:/source/main.brs:" + str(LINE_NUM)
```

</details>
