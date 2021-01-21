# Ternary (Conditional) Operator: ?
The ternary (conditional) operator is the only BrighterScript operator that takes three operands: a condition followed by a question mark (?), then an expression to execute (consequent) if the condition is true followed by a colon (:), and finally the expression to execute (alternate) if the condition is false. This operator is frequently used as a shortcut for the if statement. It can be used in assignments, and in any other place where an expression is valid. Due to ambiguity in the brightscript syntax, ternary operators cannot be used as standalone statements. See the [No standalone statements](#no-standalone-statements) for more information.

## Basic usage

```BrighterScript
a = user = invalid ? "no user" : "logged in"
```

transpiles to:

```BrightScript
a = bslib_ternary(user = invalid, "no user", "logged in")
```

The `bslib_ternarySimple` function checks the condition, and returns either the consequent or alternate. The name `iff` is a reference to Visual Basic's `iff

There are some important implications to consider for code execution order and side effects. Since both the consequent and alternate must be passed into the `bslib_ternarySimple` function, this means that both the consequent and alternate will be executed, which is certainly not what most developers intend.

Consider:

```BrighterScript
  a = user = invalid ? "no name" : user.name
```

transpiles to:
```BrightScript
a = (function(__bsCondition, user)
        if __bsCondition then
            return "no name"
        else
            return user.name
        end if
    end function)(user = invalid, user)
```

This code will crash because `user.invalid` will be evaluated.

To avoid this problem the transpiler provides conditional scope protection, as discussed in the following section.

## Scope protection

For conditional language features such as the _conditional (ternary) operator_, BrighterScript sometimes needs to protect against unintended performance hits.

There are 2 possible ways that your code can be transpiled:

### Simple
In this situation, BrighterScript has determined that both the consequent and the alternate are side-effect free and will not cause rendezvous. This means BrighterScript can use a simpler and more performant transpile target.

```BrighterScript
a = user = invalid ? "not logged in" : "logged in"
```

transpiles to:

```BrightScript
a = bslib_ternary(user = invalid, "not logged in", "logged in")
```

```BrighterScript
a = user = invalid ? defaultUser : user
```

transpiles to:

```BrightScript
a = bslib_ternary(user = invalid, defaultUser, user)
```

### Scope capturing
In this situation, BrighterScript has detected that your ternary operation will have side-effects or could possibly result in a rendezvous. BrighterScript will create an immediately-invoked-function-expression to capture all of the referenced local variables. This is in order to only execute the consequent if the condition is true, and only execute the alternate if the condition is false.

```BrighterScript
  a = user = invalid ? "no name" : user.name
```

transpiles to:

```BrightScript
a = (function(__bsCondition, user)
        if __bsCondition then
            return "no name"
        else
            return user.name
        end if
    end function)(user = invalid, user)
```

```BrighterScript
a = user = invalid ? getNoNameMessage(m.config) : user.name + m.accountType
```

transpiles to:

```BrightScript
a = (function(__bsCondition, getNoNameMessage, m, user)
        if __bsCondition then
            return getNoNameMessage(m.config)
        else
            return user.name + m.accountType
        end if
    end function)(user = invalid, getNoNameMessage, m, user)
```

### nested scope protection
The scope protection works for multiple levels as well
```BrighterScript
m.count = 1
m.increment = function ()
    m.count++
    return m.count
end function
result = (m.increment() = 1 ? m.increment() : -1) = -1 ? m.increment(): -1
```

transpiles to:
```BrightScript
m.count = 1
m.increment = function()
    m.count++
    return m.count
end function
result = (function(__bsCondition, m)
        if __bsCondition then
            return m.increment()
        else
            return - 1
        end if
    end function)(((function(__bsCondition, m)
            if __bsCondition then
                return m.increment()
            else
                return - 1
            end if
        end function)(m.increment() = 1, m)) = - 1, m)
```


## Library functions

The following library functions are called in the transpiled code:

```
function bslib_ternarySimple(isTrue, trueValue, falseValue)
    if isTrue then
        return trueValue
    else
        return falseValue
    end if
end function
```

## No standalone statements
The BrighterScript ternary operator differs from languages like C# and JavaScript in that you cannot use ternary expressions as standalone expressions. This is due to the fact that BrightScript uses `=` for both assignment and equality. As such, ternary expressions must always be part of an assignment or method call. Take a look at the following expression:
```
a = myValue ? "a" : "b"
```
This expression can be interpreted in two completely separate ways:
```
'assignment
a = (myValue ? "a" : "b'")
'ternary
(a = myValue) ? "a" : "b"
```
This ambiguity is why BrighterScript does not allow for standalone ternary expressions.