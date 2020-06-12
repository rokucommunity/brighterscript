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
textWithBacktick = "this is a backtick ` character"
```
</details>