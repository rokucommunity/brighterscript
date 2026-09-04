# Ternary (Conditional) Operator: ?
The ternary (conditional) operator takes three operands: a condition followed by a question mark (?), then an expression to execute (consequent) if the condition is true followed by a colon (:), and finally the expression to execute (alternate) if the condition is false. This operator is frequently used as a shorthand version of an if statement. It can be used in assignments or any place where an expression is valid. Due to ambiguity in the brightscript syntax, ternary operators cannot be used as standalone statements. See the [No standalone statements](#no-standalone-statements) section for more information.

## Warning
<p style="background-color: #fdf8e3; color: #333; padding: 20px">The <a href="https://developer.roku.com/docs/references/brightscript/language/expressions-variables-types.md#optional-chaining-operators">optional chaining operator</a> was added to the BrightScript runtime in <a href="https://developer.roku.com/docs/developer-program/release-notes/roku-os-release-notes.md#roku-os-110">Roku OS 11</a>, which introduced a slight limitation to the BrighterScript ternary operator. As such, all ternary expressions must have a space to the right of the question mark when followed by <b>[</b> or <b>(</b>. See the <a href="#">optional chaning</a> section for more information.
</p>

## Basic usage
The basic syntax is: `<condition> ? <value if true> : <value if false>`.

Here's an example:
```BrighterScript
authStatus = user2 <> invalid ? "logged in" : "not logged in"
```

transpiles to:

```BrightScript
if user2 <> invalid then
    authStatus = "logged in"
else
    authStatus = "not logged in"
end if
```

As you can see, when used in the right-hand-side of an assignment, brighterscript transpiles the ternary expression into a simple `if else` block.
The `bslib_ternary` function checks the condition, and returns either the consequent or alternate. In these optimal situations, brighterscript can generate the most efficient code possible which is equivalent to what you'd write yourself without access to the ternary expression.

This also works for nested ternary expressions:
```BrighterScript
result = true ? (true ? "one" : "two") : "three"
```

transpiles to:

```BrightScript
if true then
    if true then
        result = "one"
    else
        result = "two"
    end if
else
    result = "three"
end if
```

## Use in complex expressions
Ternary can also be used in any location where expressions are supported, such as function calls or within array or associative array declarations. In some  situations it's much more difficult to convert the ternary expression into an `if else` statement, so we need to leverage the brighterscript `bslib_ternary` library function instead. Consider the following example:

```BrighterScript
 printAuthStatus(user2 <> invalid ? "logged in" : "not logged in")
```

transpiles to:

```BrightScript
printAuthStatus(bslib_ternary(user2 <> invalid, "logged in", "not logged in"))
```

The `bslib_ternary` function checks the condition, and returns either the consequent or alternate.

There are some important implications to consider for code execution order and side effects. Since both the consequent and alternate must be passed into the `bslib_ternary` function, this means that both the consequent and alternate will be executed, which is certainly not what most developers intend.

Consider:

```BrighterScript
  printUsername(user = invalid ? "no name" : user.name)
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
printUsername((function(__bsCondition, user)
        if __bsCondition then
            return "no name"
        else
            return user.name
        end if
    end function)(user = invalid, user))
```
</details>


If we were to transpile this to leverage the `bslib_ternary` function, it would crash at runtime because `user.name` will be evaluated even when `user` is `invalid`. To avoid this problem the transpiler provides conditional scope protection, as discussed in the following section.

## Scope protection

Sometimes BrighterScript needs to protect against unintended performance hits. There are 3 possible ways that your code can be transpiled:

### Optimized `if else` block
In this situation, brighterscript can safely convert the ternary expression into an `if else` block. This is typically available when ternary is used in assignments.

```BrighterScript
m.username = m.user <> invalid ? m.user.name : invalid
```

transpiles to:

```BrightScript
if m.user <> invalid then
    m.username = m.user.name
else
    m.username = invalid
end if
```

### BrighterScript `bslib_ternary` library function
In this situation, BrighterScript has determined that both the consequent and the alternate are side-effect free and will not cause rendezvous or cloning, but the code was too complex to safely transpile to an `if else` block so we will leverage the `bslib_ternary` function instead.

```BrighterScript
printAuthStatus(user = invalid ? "not logged in" : "logged in")
```

transpiles to:

```BrightScript
printAuthStatus(bslib_ternary(user = invalid, "not logged in", "logged in"))
```


### Scope capturing
In this situation, BrighterScript has detected that your ternary operation will have side-effects or could possibly result in a rendezvous, and could not be transpiled to an `if else` block. BrighterScript will create an [immediately-invoked-function-expression](https://en.wikipedia.org/wiki/Immediately_invoked_function_expression) to capture all of the referenced local variables. This is in order to only execute the consequent if the condition is true, and only execute the alternate if the condition is false.

```BrighterScript
  printUsername(user = invalid ? "no name" : user.name)
```

transpiles to:

```BrightScript
printUsername((function(__bsCondition, user)
        if __bsCondition then
            return "no name"
        else
            return user.name
        end if
    end function)(user = invalid, user))
```

```BrighterScript
printMessage(user = invalid ? getNoNameMessage(m.config) : user.name + m.accountType)
```

transpiles to:

```BrightScript
printMessage((function(__bsCondition, getNoNameMessage, m, user)
        if __bsCondition then
            return getNoNameMessage(m.config)
        else
            return user.name + m.accountType
        end if
    end function)(user = invalid, getNoNameMessage, m, user))
```

### Nested Scope Protection
The scope protection works for multiple levels as well
```BrighterScript
m.count = 1
m.increment = function ()
    m.count++
    return m.count
end function
printResult((m.increment() = 1 ? m.increment() : -1) = -1 ? m.increment(): -1)
```

transpiles to:

```BrightScript
m.count = 1
m.increment = function()
    m.count++
    return m.count
end function
printResult((function(__bsCondition, m)
        if __bsCondition then
            return m.increment()
        else
            return -1
        end if
    end function)(((function(__bsCondition, m)
            if __bsCondition then
                return m.increment()
            else
                return -1
            end if
        end function)(m.increment() = 1, m)) = -1, m))
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
The ternary operator may only be used in expressions, and may not be used in standalone statements because the BrightScript grammer uses `=` for both assignments (`a = b`) and conditions (`if a = b`)

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
