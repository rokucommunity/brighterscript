# Generics

Generics let you write functions, classes, and interfaces that work with many types while keeping the type information intact. Instead of declaring a parameter `as dynamic` and losing every type check, you declare a _type parameter_ (conventionally `T`) and let BrighterScript fill in the concrete type wherever the generic is used.

Generics are a compile-time feature only. They are erased when transpiling to BrightScript, so there is no runtime cost.

## Generic functions

Declare type parameters in angle brackets right after the function name. Type parameters can then be used anywhere a type is allowed in the function signature and body.

```brighterscript
function first<T>(items as T[]) as T
    return items[0]
end function
```

When the function is called, the type arguments are inferred from the arguments that were passed in, so the return type is specific to each call:

```brighterscript
sub main()
    x = first([1, 2, 3])     ' x is an integer
    s = first(["a", "b"])    ' s is a string
    print lcase(x)           ' Validation error: lcase() expects a string, but x is an integer
end sub
```

Every argument is checked against the inferred type argument. The first use of a type parameter determines its type:

```brighterscript
function pair<T>(a as T, b as T) as T[]
    return [a, b]
end function

sub main()
    pair(1, 2)      ' ok: T is integer
    pair(1, "two")  ' Validation error: "two" is not an integer
end sub
```

A function can declare several type parameters, separated by commas: `function zip<K, V>(keys as K[], values as V[])`.

## Constraints

By default nothing is known about a type parameter, so inside the generic a value of type `T` can only be stored, returned, or passed to another `T`. Use `extends` to declare an upper bound. A constrained type parameter accepts only types compatible with the constraint, and the constraint's members are available inside the generic:

```brighterscript
class Animal
    sub speak()
        print "..."
    end sub
end class

function loudest<T extends Animal>(animals as T[]) as T
    for each animal in animals
        animal.speak()   ' ok: T is known to be an Animal
    end for
    return animals[0]
end function

sub main()
    loudest([new Dog(), new Dog()])  ' ok, returns a Dog
    loudest(["cat"])                 ' Validation error: 'string' does not satisfy the constraint 'Animal'
end sub
```

Any type can be used as a constraint, including unions, interfaces, and other generic types.

## Generic classes

Classes declare type parameters after the class name. The type parameters are available to every field and method in the class:

```brighterscript
class Queue<T>
    private data as T[] = []

    sub push(item as T)
        m.data.push(item)
    end sub

    function pop() as T
        return m.data.shift()
    end function
end class
```

Supply type arguments when constructing the class, or let BrighterScript infer them from the constructor arguments:

```brighterscript
sub main()
    ints = new Queue<integer>()
    ints.push(1)
    ints.push("one")        ' Validation error: "one" is not an integer
    value = ints.pop()      ' value is an integer

    holder = new Holder(1)  ' T is inferred as integer from the constructor argument
end sub

class Holder<T>
    value as T
    sub new(value as T)
        m.value = value
    end sub
end class
```

Constructing a generic class without type arguments (`new Queue()`) gives every type parameter its constraint, or `dynamic` when it has none.

Classes can extend instantiated generic classes, and type arguments can be nested:

```brighterscript
class IntQueue extends Queue<integer>
end class

sub main()
    queues = new Queue<Queue<integer>>()
    queues.push(new IntQueue())
end sub
```

Methods can declare their own type parameters, whether or not the class is generic:

```brighterscript
class Mapper
    function map<T, U>(items as T[], mapper as function(item as T) as U) as U[]
        result = []
        for each item in items
            result.push(mapper(item))
        end for
        return result
    end function
end class
```

## Generic interfaces

Interfaces support type parameters in the same way. Because interfaces are checked structurally, any value whose members match the instantiated interface is accepted:

```brighterscript
interface Container<T>
    items as T[]
    function get(index as integer) as T
end interface

sub printAll(container as Container<string>)
    for each item in container.items
        print lcase(item)   ' ok: item is a string
    end for
end sub
```

## Type arguments

Type arguments can be supplied anywhere a type is written: parameter and return types, field types, typecasts, `extends` clauses, `type` statements, typed arrays, and `new` expressions.

```brighterscript
type StringQueue = Queue<string>

sub process(input as Queue<string>[], lookup as Data.Pair<string, integer>)
    names = input[0] as StringQueue
end sub
```

The compiler reports an error when the number of type arguments doesn't match the declaration, when a type argument doesn't satisfy its constraint, or when type arguments are given to a type that isn't generic.

## Type checking rules

- A type parameter is only compatible with itself (and with `dynamic`, `object`, and `invalid`). Inside `function make<T>() as T`, `return 1` is an error, because the caller decides what `T` is.
- Where a concrete type is expected, a constrained type parameter is treated as its constraint. An unconstrained type parameter is not compatible with any concrete type; cast it (`value as string`) if you know better than the compiler.
- Member access on an unconstrained type parameter is allowed and results in `dynamic`, matching how BrighterScript treats unknown values elsewhere.
- Type arguments are inferred from the arguments of a call (or constructor). Explicit type arguments on function calls (`first<integer>(items)`) are not supported; use a typecast on the result if the inferred type needs adjusting.

## Transpilation

Type parameters and type arguments are removed entirely. A type parameter transpiles to its constraint's runtime type when that is a native BrightScript type, and to `dynamic` otherwise.

```brighterscript
function first<T>(items as T[]) as T
    return items[0]
end function

function upper<T extends string>(value as T) as T
    return ucase(value)
end function

sub main()
    q = new Queue<integer>()
end sub
```

transpiles to

```BrightScript
function first(items as dynamic) as dynamic
    return items[0]
end function

function upper(value as string) as string
    return ucase(value)
end function

sub main()
    q = Queue()
end sub
```

Generated type definition files (`.d.bs`) keep the type parameters and type arguments, so consumers of a library get the full generic signatures.
