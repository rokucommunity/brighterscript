# Regular Expression Literals
You can create a regular expression literal in brighterscript. This simplifies pattern writing and improves readability.

Example:
```BrighterScript
print /hello world/ig
```

transpiles to:

```BrightScript
print CreateObject("roRegex","hello world","ig")
```
