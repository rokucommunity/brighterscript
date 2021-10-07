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
