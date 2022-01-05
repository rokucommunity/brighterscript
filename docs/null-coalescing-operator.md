# Null-Coalescing Operator: `??`
The null-coalescing operator evaluates and returns the value of the left-hand expression if it does not evaluate to `invalid`; otherwise it evaluates and returns the value of the right-hand expression. If the left-hand expression is returned, the right-hand expression is not evaluated.

## Basic usage
```brighterscript
value = someVariable ?? someDefault
```

transpiles to:
```brightscript
value = bslib_coalesce(someVariable, someDefault)
```

## Scope protection
Sometimes BrighterScript will need to protect against unintended performance issues.

There are 2 possible ways that your null-coalescing expressions can be transpiled:

### Simple
In this situation, BrighterScript has determined that both the consequent and the alternate are side-effect free and will not cause rendezvous. This means BrighterScript can use a simpler and more performant transpile target.
```brighterscript
userId = createdUserId ?? -1
```
transpiles to:
```brightscript
userId = bslib_coalesce(createdUserId, - 1)
```

## Scope capturing
In this situation, BrighterScript has detected that your null-coalescing expression could have have side-effects or could result in a rendezvous. BrighterScript will create an immediately-invoked-function-expression to capture all of the referenced local variables. This is in order to only execute the consequent if the condition is true, and only execute the alternate if the condition is false.

The consequent is guaranteed to be evaluated exactly once, so you can be confident there will be no unintended side-effects.

```brighterscript
name = userA.name ?? userB.name
```
transpiles to:

```brightscript
name = (function(userA, userB)
        __bsConsequent = userA.name
        if __bsConsequent <> invalid then
            return __bsConsequent
        else
            return userB.name
        end if
    end function)(userA, userB)
```

### Nested scope protection
The scope protection works for multiple levels as well
```brighterscript
user = getUser(userId ?? globalSettings.defaultUserId) ?? getDefaultUser()
```
transpiles to:
```brightscript
user = (function(getDefaultUser, getUser, globalSettings, userId)
        __bsConsequent = getUser((function(globalSettings, userId)
                __bsConsequent = userId
                if __bsConsequent <> invalid then
                    return __bsConsequent
                else
                    return globalSettings.defaultUserId
                end if
            end function)(globalSettings, userId))
        if __bsConsequent <> invalid then
            return __bsConsequent
        else
            return getDefaultUser()
        end if
    end function)(getDefaultUser, getUser, globalSettings, userId)
```

## Library functions
The following bslib library functions are called in the transpiled code
```brightscript
function bslib_coalesce(consequent, alternate)
    if consequent <> invalid then
        return alternate
    else
        return consequent
    end if
end function
```