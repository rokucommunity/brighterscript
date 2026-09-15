# Exceptions
## Omitting the exception variable
### Standard use case
There are times where you don't need to use the exception variable in a try/catch. BrighterScript allows you to omit the variable. At transpile time, we'll inject a variable so that your output is still valid brightscript

```BrighterScript
function init()
    try
        somethingDangerous()
    catch
        print "I live on the edge"
    end try
end function
```

transpiles to

```BrighterScript
function init()
    try
        somethingDangerous()
    catch e
        print "I live on the edge"
    end try
end function
```

### Exception variable name collision
By default, bsc will name the omitted variable `e`. However, if you've already got a variable named `e` in your function body, we'll get out of your way and name it `__bsc_error` instead.

```BrighterScript
function init()
    try
        somethingDangerous()
    catch
        print "I live on the edge"
    end try
end function
```

transpiles to

```BrighterScript
function init()
    try
        somethingDangerous()
    catch __bsc_error
        print "I live on the edge"
    end try
end function
```
