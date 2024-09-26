# Exceptions
## Omitting the exception variable
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
