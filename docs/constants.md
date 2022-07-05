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
    sub printBaseUrl()
        print BASE_URL
    end sub
end namespace
sub main()
    print networking.BASE_URL
end sub
```

transpiles to

```BrightScript
sub main()
    print "https://your-app.com/api/v1"
end sub
```

## Complex objects
Constants can contain complex objects or arrays as well, but keep in mind that these are inlined at compile-time, so it is not recommended to reach into these objects for specific values all the time.

```BrighterScript
namespace networking
	const HEADERS = {
		"Authorization": "Basic",
		"Access-Control-Allow-Credentials": "true"
	}
	const METHODS = [
	    "GET",
	    "POST",
	    "PUT",
	    "DELETE"
	]
end namespace
sub main()
    print networking.HEADERS
    print networking.METHODS
end sub
```
**Transpiled:**
```vb
sub main()
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
