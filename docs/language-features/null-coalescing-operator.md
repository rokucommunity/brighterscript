# Null-Coalescing Operator
The null-coalescing operator (`??`) evaluates and returns the value of the left-hand expression if it does not evaluate to `invalid`; otherwise it evaluates and returns the value of the right-hand expression. If the left-hand expression is returned, the right-hand expression is not evaluated. For conditions other than `invalid`, see the [ternary operator](ternary-operator.md).

## Basic usage
```brighterscript
value = someVariable ?? someDefault
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
value = bslib_coalesce(someVariable, someDefault)
```

</details>

## Scope protection
Sometimes BrighterScript will need to protect against unintended performance issues.

There are 2 possible ways that your null-coalescing expressions can be transpiled:

### Simple
In this situation, BrighterScript has determined that both the consequent and the alternate are side-effect free and will not cause rendezvous. This means BrighterScript can use a simpler and more performant transpile target.
```brighterscript
userId = createdUserId ?? -1
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
userId = bslib_coalesce(createdUserId, -1)
```

</details>

## Scope capturing
In this situation, BrighterScript has detected that your null-coalescing expression could have have side-effects or could result in a rendezvous. BrighterScript will create an immediately-invoked-function-expression to capture all of the referenced local variables. This is in order to only execute the consequent if the condition is true, and only execute the alternate if the condition is false.

The consequent is guaranteed to be evaluated exactly once, so you can be confident there will be no unintended side-effects.

```brighterscript
name = userA.name ?? userB.name
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
name = userA.name
if name = invalid then
    name = userB.name
end if
```

</details>

### Nested scope protection
The scope protection works for multiple levels as well
```brighterscript
user = getUser(userId ?? globalSettings.defaultUserId) ?? getDefaultUser()
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
user = getUser((function(globalSettings, userId)
        __bsConsequent = userId
        if __bsConsequent <> invalid then
            return __bsConsequent
        else
            return globalSettings.defaultUserId
        end if
    end function)(globalSettings, userId))
if user = invalid then
    user = getDefaultUser()
end if
```

</details>

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
