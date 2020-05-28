# callfunc operator
In BrightScript, calling a function on a custom comment requires you to use the [callfunc](https://developer.roku.com/docs/developer-program/core-concepts/handling-application-events.md) function. A standard callfunc expression looks something like this: `node.callFunc("functionName", someArg, someOtherArg)`. This deviates from the conventional `object.someMethod()` synax you are used to with standard objects.

Which leads us to the callfunc operator in BrighterScript. This is denoted by an at symbol followed by a period. ( `@.` ). Whenever BrighterScript encounters the callfunc operator, it will transpile the code into a valid callfunc expression, while allowing you to write _mostly_ the same type of syntax you're used to for object method calls. 

Here's a simple example:

```BrighterScript
node@.someMethod(1,2,3)
```

Gets transpiled to
```BrightScript
node.callfunc("someMethod", 1, 2, 3)
```

## Callfunc evaluation with no arguments
It is a well-known issue in BrightScript development that calling `callfunc` without at least one parameter has the potential to result in the function not being called at all. So to mitigate this issue, BrighterScript will automatically insert `invalid` as the first argument if you use the callfunc operator with no parameters.

For example, this: 

```BrighterScript
node@.doSomething()
```

will be transpiled into this:
```brightscript
node.callfunc("doSomething", invalid)
```

It is the developer's responsiblity to ensure that the target function has at least one parameter, and that the type is dynamic, otherwise a type mismatch runtime error will occur.
