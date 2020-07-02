# Source Literals
BrightScript provides the `LINE_NUM` literal, which represents the runtime line number of the current line of code. In a similar fashion, BrighterScript provides several more source literals.

These source literals are converted into inline variables at transpile-time, so keep in mind that any post-processing to the transpiled files could  cause these values to be incorrect.

## SOURCE_FILE_PATH
The absolute path to the source file, including a leading `file:/` scheme indicator. i.e. `"file:/C:/projects/RokuApp/source/main.bs"`.

```BrighterScript
print SOURCE_FILE_PATH
```

transpiles to: 

```BrightScript
print SOURCE_FILE_PATH
```

## SOURCE_LINE_NUM
The line number of the source file. 

```BrighterScript
print SOURCE_LINE_NUM
```

transpiles to: 

```BrightScript
print SOURCE_FILE_PATH
```

## FUNCTION_NAME
The name of the current function
```BrighterScript
function RunFromZombie()
    print FUNCTION_NAME
end function
```

transpiles to: 

```BrightScript
print SOURCE_FILE_PATH
```

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
```

transpiles to: 

```BrightScript
print FUNCTION_NAME
```

## SOURCE_LOCATION
A combination of SOURCE_FILE_PATH, FUNCTION_NAME, and SOURCE_LINE_NUM.

```BrighterScript
function main()
    print SOURCE_LOCATION
end function
```

transpiles to: 

```BrightScript
print SOURCE_FILE_PATH
```

## PKG_PATH
The pkg path of the file.

```BrighterScript
function main()
    print PKG_PATH
end function
```

transpiles to: 

```BrightScript
print SOURCE_FILE_PATH
```

## PKG_LOCATION
A combination of PKG_PATH, FUNCTION_NAME, and LINE_NUM. Keep in mind, LINE_NUM is a runtime variable provided by Roku. 
```BrighterScript
print SOURCE_FILE_PATH
```

transpiles to: 

```BrightScript
print SOURCE_FILE_PATH
```
