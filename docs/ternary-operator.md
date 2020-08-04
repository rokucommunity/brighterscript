# Conditional (Ternary) Operator: ?
The conditional (ternary) operator is the only BrighterScript operator that takes three operands: a condition followed by a question mark (?), then an expression to execute (consequent) if the condition is true followed by a colon (:), and finally the expression to execute (alternate) if the condition is false. This operator is frequently used as a shortcut for the if statement. It can be used in assignments, and in any other place where an expression is valid. Due to ambiguity in the brightscript syntax, ternary operators cannot be used as standalone statements. See the [No standalone statements](#no-standalone-statements) for more information.

## Basic usage

```BrighterScript
a = user = invalid ? "no user" : "logged in"
```

transpiles to: 

```BrightScript
a = bslib_simpleTernary(user = invalid, "no user", "logged in")
```

The `bslib_simpleTernary` function checks the condition, and returns either the consequent or alternate.

There are some important implications to consider for code execution order and side effects. Since both the consequent and alternate must be passed into the `bslib_simpleTernary` function, this means that both the consequent and alternate will be executed, which is certainly not what most developers intend.

Consider:

```BrighterScript
  a = user = invalid ? "no name" : user.name
```

transpiles to:
```BrightScript
a = bslib_simpleTernary(user = invalid, "no name", user.invalid)
```

This code will crash because `user.invalid` will be evaluated.

To avoid this problem the transpiler provides conditional scope protection settings, as discussed in the following section.

## Scope protection

For conditional language features such as the _conditional (ternary) operator_, BrighterScript provides a `conditionalScopeProtection` config setting, to allow the developer to specify how to handle transpilation.

There are 2 possible setting:

  * `safe` - consequent and alternate will be wrapped in an inline function to prevent side effects if any function calls (e.g. `someNode.getValue()`) or dotted gets (e.g. `user.name`) are present in either the consequent or alternate.
  * `none` - consequent and alternate are not wrapped in a function. This is not advised.

The default setting is `safe`.


### conditionalScopeProtection: safe

```BrighterScript
  a = user = invalid ? "no name" : user.name
```

transpiles to: 

```BrightScript
a = bslib_scopeSafeTernary(user, {
  "user": user
},function(scope)
  user = scope.user
  return "no name"
end function
 function(scope)
  user = scope.user
  return user.name
 end function) 
```

```BrighterScript
a = user = invalid ? getNoNameMessage(m.config) : user.name + m.accountType
```

transpiles to: 

```BrightScript
a = bslib_scopeSafeTernary(user, {
  "user": user
  "m": m
},function(scope)
  user = scope.user
  m = scope.m
  return getNonNameMessage(m.config)
end function
 function(scope)
  user = scope.user
  m = scope.m
  return user.name + m.accountType
 end function) 
```

### conditionalScopeProtection: none

```BrighterScript
a = user = invalid ? getNoNameMessage() : user.name
```

transpiles to: 

```BrightScript
a = bslib_simpleTernary(user = invalid, getNoNameMessage(), user.name)
```

```BrighterScript
a = user = invalid ? getNoNameMessage(m.config) : user.name + m.accountType
```

transpiles to: 

```BrightScript
a = bslib_simpleTernary(user = invalid, getNoNameMessage(m.config), user.name + m.accountType)
```

## Library functions

The following library functions are called in the transpiled code:

```
function bslib_simpleTernary(isTrue, trueValue, falseValue)
    if isTrue then
        return trueValue
    else
        return falseValue
    end if
end function

function bslib_scopeSafeTernary(isTrue, scope, trueFunc, falseFunc)
    if isTrue then
        return trueFunc(scope)
    else
        return falseFunc(scope)
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
