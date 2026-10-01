# Destructuring Assignment

Destructuring assignment unpacks values from arrays, or properties from associative arrays and objects, into distinct variables in a single statement. It follows the same shape as [destructuring in JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Destructuring), and transpiles to plain BrightScript assignments.

## Object destructuring

```brighterscript
sub main()
    person = { name: "bob", age: 12 }
    { name, age } = person
    print name; age
end sub
```

transpiles to

```brightscript
sub main()
    person = {
        name: "bob"
        age: 12
    }
    name = person.name
    age = person.age
    print name; age
end sub
```

### Assigning to a different variable name

Use `key: variable` to store a property in a variable with a different name:

```brighterscript
{ name: userName, age: userAge } = person
```

transpiles to

```brightscript
userName = person.name
userAge = person.age
```

### String literal keys

Keys that are not valid identifiers can be written as string literals. These must always be given a target variable name:

```brighterscript
{ "first name": firstName } = person
```

transpiles to

```brightscript
firstName = person["first name"]
```

### Nested patterns

Patterns can be nested to any depth. Each nested level is read exactly once into a temporary variable:

```brighterscript
{ address: { city, geo: [lat, lng] } } = person
```

transpiles to

```brightscript
__bsDestructure0 = person.address
city = __bsDestructure0.city
__bsDestructure1 = __bsDestructure0.geo
lat = __bsDestructure1[0]
lng = __bsDestructure1[1]
```

### Default values

A default value is used when the destructured value is `invalid` (a missing key, or an index beyond the end of an array). The default expression is only evaluated when it is needed:

```brighterscript
{ name = "unknown", age = getDefaultAge() } = person
```

transpiles to

```brightscript
name = person.name
if name = invalid then name = "unknown"
age = person.age
if age = invalid then age = getDefaultAge()
```

### Rest properties

A rest element collects every property that was not explicitly named into a new associative array:

```brighterscript
{ name, ...others } = person
```

transpiles to

```brightscript
name = person.name
others = {}
others.append(person)
others.delete("name")
```

The rest element must be the last item in the pattern, and (like the [spread operator](spread-operator.md)) the `...` must be immediately followed by the variable name.

## Array destructuring

```brighterscript
[first, second] = items
```

transpiles to

```brightscript
first = items[0]
second = items[1]
```

### Skipping elements

Leave a slot empty to skip an index:

```brighterscript
[, second, , fourth] = items
```

transpiles to

```brightscript
second = items[1]
fourth = items[3]
```

### Default values

```brighterscript
[first, second = 2] = items
```

transpiles to

```brightscript
first = items[0]
second = items[1]
if second = invalid then second = 2
```

### Rest elements

A rest element collects the remaining items into a new array:

```brighterscript
[first, ...rest] = items
```

transpiles to

```brightscript
first = items[0]
rest = []
for __bsDestructure0 = 1 to items.count() - 1
    rest.push(items[__bsDestructure0])
end for
```

### Swapping variables

Because the right-hand side is fully evaluated before any assignment happens, destructuring can swap variables in one statement:

```brighterscript
[a, b] = [b, a]
```

transpiles to

```brightscript
__bsDestructure0 = [
    b
    a
]
a = __bsDestructure0[0]
b = __bsDestructure0[1]
```

## Combining with the spread operator

The right-hand side may use the [spread operator](spread-operator.md). The spread literal is built first, then destructured:

```brighterscript
{ name, ...others } = { ...defaults, name: "bob" }
```

transpiles to

```brightscript
__bsc_tmp = {}
__bsc_tmp.append(defaults)
__bsc_tmp.name = "bob"
name = __bsc_tmp.name
others = {}
others.append(__bsc_tmp)
others.delete("name")
```

## Evaluation of the right-hand side

When the right-hand side is a plain variable, its members are read directly from that variable. Any other expression (a function call, a property access, a literal, etc.) is evaluated exactly once into a temporary variable named `__bsDestructure<n>`, so functions with side effects are never called more than once. A temporary variable is also used when the source variable is itself one of the targets (i.e. `[items, other] = items`).

## Type inference

BrighterScript infers a type for every destructured variable:

- Object pattern properties receive the type of that member on the source (from an interface, class, or associative array literal).
- Array pattern elements receive the element type of the source array (i.e. `string` for `Array<string>`).
- A rest element is typed as `roAssociativeArray` for object patterns and `Array<T>` for array patterns.
- When a default value is present, `invalid` is removed from the inferred type and the type of the default value is merged in.
- When the source type is unknown, the variables are `dynamic`.

```brighterscript
interface Person
    name as string
    age as integer
end interface

sub greet(person as Person)
    { name, age } = person ' name is a string, age is an integer
    print ucase(name); age + 1
end sub
```

## Limitations

- Targets must be plain variable names. Assigning into properties (`{ name: m.name } = person`) or indexes (`[arr[0]] = items`) is not supported.
- Destructuring is only available as a statement. It cannot be used in function parameters or `for each` loops.
- Type annotations (`as string`) are not supported on destructured variables.
