# Regular Expression Literals
You can create a regular expression literal in BrighterScript. This simplifies pattern writing and improves readability. You can use these regular expression literals anywhere you would normally use `CreateObject("roRegex", "the-pattern", "g")`.

## Basic usage
```BrighterScript
print /hello world/ig
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
print CreateObject("roRegex", "hello world", "ig")
```

</details>

## Considerations
### Escape the forward slash character
Since the forward slash character (`/`) indicates the start and end of the expression, you must escape it with a backslash.

Example:
```brighterscript
print /hello\/world/
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
print CreateObject("roRegex", "hello\/world", "")
```

</details>
