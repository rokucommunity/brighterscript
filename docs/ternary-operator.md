# Ternary (Conditional) Operator: ?
The ternary (conditional) operator is the only BrighterScript operator that takes three operands: a condition followed by a question mark (?), then an expression to execute (consequent) if the condition is true followed by a colon (:), and finally the expression to execute (alternate) if the condition is false. This operator is frequently used as a shortcut for the if statement. It can be used in assignments, and in any other place where an expression is valid. Due to ambiguity in the brightscript syntax, ternary operators cannot be used as standalone statements. See the [No standalone statements](#no-standalone-statements) section for more information.

## Warning
<p style="background-color: #fdf8e3; color: #333; padding: 20px">The <a href="https://developer.roku.com/docs/references/brightscript/language/expressions-variables-types.md#optional-chaining-operators">optional chaining operator</a> was added to the BrightScript runtime in <a href="https://developer.roku.com/docs/developer-program/release-notes/roku-os-release-notes.md#roku-os-110">Roku OS 11</a>, which introduced a slight limitation to the BrighterScript ternary operator. As such, all ternary expressions must have a space to the right of the question mark when followed by <b>[</b> or <b>(</b>. See the <a href="#">optional chaning</a> section for more information.
</p>

## Basic usage

```BrighterScript
authStatus = user <> invalid ? "logged in" : "not logged in"
```

transpiles to:

```BrightScript
authStatus = bslib_ternary(user <> invalid, "logged in", "not logged in")
```

The `bslib_ternary` function checks the condition, and returns either the consequent or alternate.

There are some important implications to consider for code execution order and side effects. Since both the consequent and alternate must be passed into the `bslib_ternary` function, this means that both the consequent and alternate will be executed, which is certainly not what most developers intend.

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

### Nested Scope Protection
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
function bslib_ternary(isTrue, trueValue, falseValue)
    if isTrue then
        return trueValue
    else
        return falseValue
    end if
end function
```

## No standalone statements
The ternary operator may only be used in expressions and may not be used in standalone statements because the BrightScript grammer uses `=` for both assignments (`a = b`) and conditions (`if a = b`)

```brightscript
' this is generally not valid
condition ? doSomething() : orElse()
```


For example:
```brightscript
a = myValue ? "a" : "b"
```

This expression can be interpreted in two completely separate ways:

```brightscript
'assignment
a = (myValue ? "a" : "b'")
'ternary
(a = myValue) ? "a" : "b"
```

This ambiguity is why BrighterScript does not allow for standalone ternary statements.


## Optional Chaining considerations
The [optional chaining operator](https://developer.roku.com/docs/references/brightscript/language/expressions-variables-types.md#optional-chaining-operators) was added to the BrightScript runtime in <a href="https://developer.roku.com/docs/developer-program/release-notes/roku-os-release-notes.md#roku-os-110">Roku OS 11</a>, which introduced a slight limitation to the BrighterScript ternary operator. As such, all ternary expressions must have a space to the right of the question mark when followed by `[` or `(`. If there's no space, then it's optional chaining.

For example:

*Ternary:*
```brightscript
data = isTrue ? ["key"] : getFalseData()
data = isTrue ? (1 + 2) : getFalseData()
```
*Optional chaining:*
```brightscript
data = isTrue ?["key"] : getFalseData()
data = isTrue ?(1 + 2) : getFalseData()
```

The colon symbol `:` can be used in BrightScript to include multiple statements on a single line. So, let's look at the first ternary statement again.
```brightscript
data = isTrue ? ["key"] : getFalseData()
```

This can be logically rewritten as:
```brightscript
if isTrue then
    data = ["key"]
else
    data = getFalseData()
```

Now consider the first optional chaining example:
```brightscript
data = isTrue ?["key"] : getFalseData()
```
This can be logically rewritten as:
```brightscript
data = isTrue ?["key"]
getFalseData()
```

Both examples have valid use cases, so just remember that a single space could result in significantly different code output.
