# Computed Property Names

BrighterScript supports using computed property names for associative array keys via the `[expr]` bracket syntax, similar to [computed property names in JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Object_initializer#computed_property_names).

The expression inside the brackets must resolve to a **string** at compile-time. Currently only [enum members](enums.md) (string enums), [constants](constants.md), and string literals are supported.

> [!NOTE]
>**Currently runtime values, such as variables, are not supported**

## Enum members

String [enum](enums.md) members can be used as computed keys. The enum value is inlined at compile-time.

```brighterscript
enum ApiPath
    login = "/login"
    logout = "/logout"
    profile = "/profile"
end enum

sub main()
    handlers = {
        [ApiPath.login]: loginHandler,
        [ApiPath.logout]: logoutHandler,
        [ApiPath.profile]: profileHandler
    }
end sub
```


<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub main()
    handlers = {
        "/login": loginHandler
        "/logout": logoutHandler
        "/profile": profileHandler
    }
end sub
```

</details>

Namespaced enums work the same way:

```brighterscript
namespace Api
    enum Path
        login = "/login"
        profile = "/profile"
    end enum
end namespace

sub main()
    handlers = {
        [Api.Path.login]: loginHandler,
        [Api.Path.profile]: profileHandler
    }
end sub
```

## Constants

String [constants](constants.md) can also be used as computed keys.

```brighterscript
const KEY_NAME = "displayName"
const KEY_AGE = "displayAge"

sub main()
    labels = {
        [KEY_NAME]: "Name",
        [KEY_AGE]: "Age"
    }
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub main()
    labels = {
        "displayName": "Name"
        "displayAge": "Age"
    }
end sub
```

</details>

Namespaced constants work as well:

```brighterscript
namespace Config
    const PRIMARY_COLOR = "primaryColor"
    const SECONDARY_COLOR = "secondaryColor"
end namespace

sub main()
    theme = {
        [Config.PRIMARY_COLOR]: "#ff0000",
        [Config.SECONDARY_COLOR]: "#0000ff"
    }
end sub
```

## Mixing computed and regular keys

Computed and regular keys can be freely mixed in the same associative array.

```brighterscript
enum Field
    title = "title"
end enum

sub main()
    data = {
        id: 1,
        [Field.title]: "Hello World",
        ["some-meta"]: true
    }
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub main()
    data = {
        id: 1
        "title": "Hello World"
        "some-meta": true
    }
end sub
```

</details>

## String literals

The most basic use case is a string literal in brackets.

```brighterscript
sub main()
    headers = {
        ["Content-Type"]: "application/json",
        ["X-Api-Key"]: "abc123"
    }
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub main()
    headers = {
        "Content-Type": "application/json"
        "X-Api-Key": "abc123"
    }
end sub
```

</details>

## Restrictions

### Only string values are allowed

The expression must resolve to a **string** value. Numeric enum members and numeric constants are compile-time errors.

```brighterscript
enum Direction
    up    ' integer (value: 0)
    down
end enum

const TIMEOUT = 30

sub main()
    m.data = {
        [Direction.up]: "value",  ' error: computed AA keys must resolve to a string value
        [TIMEOUT]: "value"        ' error: computed AA keys must resolve to a string value
    }
end sub
```

### Only compile-time constants are allowed

The expression must be resolvable at compile-time. Runtime variables are not allowed.

```brighterscript
sub main()
    key = "someKey"
    m.data = {
        [key]: "value"  ' error: computed property keys must be a compile-time constant
    }
end sub
```
