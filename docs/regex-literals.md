# Regular Expression Literals
You can create a regular expression literal in brighterscript. This simplifies pattern writing and improves readability. You can use these regular expression literals anywhere you would normally use `CreateObject("roRegex", "the-pattern", "g")`.

Example:
```BrighterScript
print /hello world/ig
```

transpiles to:

```BrightScript
print CreateObject("roRegex", "hello world", "ig")
```

## Considerations
### Escape the forward slash character
Since the forward slash character (`/`) indicates the start and end of the expression, you must escape it with a backslash. 

Example:
```brighterscript
print /hello\/world/
```

transpiles to 
```brightscript
print CreateObject("roRegex", "hello\/world", "")
```
