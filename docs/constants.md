# Constants
You can use the `const` keyword to declare constant values. These values cannot ever be modified. These constants will be inlined at compile-time, which is very efficient(similar to how [enums](enums.md) work). Constants cannot be changed at runtime.

These are not to be confused with the conditional compile `#const` statements, which are a completely separate concept.

## Basic usage
Consts can be defined at the root level of files, and are scoped the same way as functions.
```BrighterScript
const GREETING_MESSAGE = "Hello world"
sub main()
    print GREETING_MESSAGE
end sub
```
transpiles to
```BrightScript
sub main()
    print "Hello world"
end sub
```

## Namespaced Consts
Consts can be defined within namespaces, and accessed like a property.

```BrighterScript
namespace networking
    const BASE_URL = "https://your-app.com/api/v1"
end namespace
sub main()
    print BASE_URL
end sub
```

transpiles to

```BrightScript
sub main()
    print "https://your-app.com/api/v1"
end sub
```

**Transpiled:**
```vb
sub main()
	print "https://your-app.com/api/v1"
	print "abcd1234"
	print {
		"Authorization": "Basic",
		"Access-Control-Allow-Credentials": "true"
	}
	print [
		"GET",
		"POST",
		"PUT",
		"DELETE"
	]
end sub
```
