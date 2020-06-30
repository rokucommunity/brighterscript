# Template strings (Template literals)
Template strings are string literals that can have embedded expressions and also capture newlines. 

## Syntax
```BrighterScript

name = `John Smith`

text = `hello ${name}`

text = `first line text
second line text`

text = tag`hello ${name} how are you`
```
transpiles to
```BrightScript
name = "John Smith"
text = "hello " + bslib_toString(name)
text = "first line text" + chr(10) + "second line text"
```

## Description
Template strings begin and end with the backtick ( ` )  character instead of double quotes.

Template strings can include embedded expressions, which are wrapped in a dollar sign and curly braces (i.e. `${someExpression}`). Any valid expression is supported, including function calls.

## Newlines and escape characters
Newlines for multi-line template strings are automatically captured. Since BrightScript does not support escape characters, BrighterScript will convert the template string into a series of strings and `chr()` calls. For example:

```BrighterScript
text = `line1
line2
`
```

Transpiles to
```BrightScript
text = "line1" + chr(10) + "line2" + chr(10)
``` 

You can also use escape characters in your text. For example, `\n` for unix-style line endings and `\r\n` for windows-style line endings.
```BrighterScript
unixText = "line1\nline2"
windowsText = "line1\r\nline2"
```
<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
unixText = "line1\nline2"
windowsText = "line1\r\nline2"
```
</details>

If you want to include a backtick in your template string, you will need to escape that as well.
```BrighterScript
textWithBacktick = `this is a backtick \` character`
```
<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
textWithBacktick = "this is a backtick " + chr(96) + " character"
```
</details>

If you want to include the literal text `${}` in your string, you can escape the leading dollar sign like so:
```BrighterScript
text = `look \${here}`
```
<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
text = "look " + chr(36) + "{here}"
```
</details>

### Escaping unicode characters
You also have the option to escape unicode characters. Since most BrightScript developers are already familiar with calling `chr(charCode)`, BrighterScript makes this simple. Just prefix your char code with `\c`. For example, if you wanted to insert char code 22 into a string, you could do this:

```BrighterScript
text = `abc\c22def`
```
<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
text = "abc" + chr(22) + "def"
```
</details>

### Capturing quotes

Quotemarks found within template strings will be transpiled to `chr(34)` calls.

```BrighterScript
stringWithQuotes = `hello "John"`
```
transpiles to
```BrightScript
stringWithQuotes = "hello " + chr(34) + "John" + chr(34)
```


## Tagged Template Strings
If a template string is preceeded by an expression, this is called a tagged template. In this situation, the tag expression will be called with all of the values of the template string. The tag function is not limited to returning strings: it can return whatever you want. 

The tag function accepts two arguments: an array of strings and an array of expressions. There will always be one more string than expression, and generally you should iterate through as follows: `strings[0] + values[0] + strings[1] values[1] + strings[2] ...`

### Simple example
```BrighterScript
function zombify(strings, values)
    result = ""
    for i = 0 to strings.count() - 1
        value = values[i]
        if value = "Human" then
          value = "Zombie"
        end if
        result = result + strings[i] + value
    end for
    result += strings[i]
    return result
end function

function main()
  name = "Human"
  print zombify`Hello ${name}` ' prints "Hello Zombie"
end function
```

<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
function zombify(strings, values)
    result = ""
    for i = 0 to strings.count() - 1
        value = values[i]
        if value = "Human" then
            value = "Zombie"
        end if
        result = result + strings[i] + value
    end for
    result += strings[i]
    return result
end function

function main()
    name = "Human"
    print zombify ; "Hello " + bslib_toString(name) ' prints "Hello Zombie"
end function
```
</details>


### Returning non strings
Tag functions don't even need to return a string.
```BrighterScript
function zombify(strings, values)
    return new Zombie(values[0])
end function

function main()
  name = "Human"
  result = zombify`Hello ${name}`
end function
```

<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
function zombify(strings, values)
    return Zombie(values[0])
end function

function main()
    name = "Human"
end function
```
</details>
