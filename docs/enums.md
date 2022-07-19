# Enums

BrighterScript Enums are a way to define a set of named constants, sharing many similarities to their implementations in other languages such as [TypeScript](https://www.typescriptlang.org/docs/handbook/enums.html) and [C#](https://docs.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/enum).

## Enums at runtime
Enums do not exist at runtime. Instead, the literal values are inserted into the code. See the next section for an example.

## Numeric enums
The most common type of enum is the numeric enum.
```BrighterScript
enum Direction
    up
    down
    left
    right
end enum
sub main()
    print Direction.up
    print Direction.down
    print Direction.left
    print Direction.right
end sub
```

transpiles to

```BrightScript
sub main()
    print 0
    print 1
    print 2
    print 3
end sub
```

Notice how the enum completely disappears from the output code? That's because enums only exist at compile-time. At runtime, their literal values are injected into their reference locations.

By default, enums are type `integer`, and start with the initial value of zero, increasing by one for each enum member. You can also use initializers to set the values of the enum.

```brighterscript
enum Direction
    up = 5
    down
    left = 10
    right
end enum
sub main()
    print Direction.up
    print Direction.down
    print Direction.left
    print Direction.right
end sub
```

transpiles to

```BrightScript
sub main()
    print 5
    print 6
    print 10
    print 11
end sub
```

In this scenario, `Direction.down` is given the next whole number after its previous member. Same with `Direction.right`.

## String enums
String enums are similar to numeric enums, except that each member must be given an explicit value.

```brighterscript
enum Direction
    up = "up"
    down = "down"
    left = "left"
    right = "right"
end enum
sub main()
    print Direction.up
    print Direction.down
    print Direction.left
    print Direction.right
end sub
```

transpiles to

```BrightScript
sub main()
    print "up"
    print "down"
    print "left"
    print "right"
end sub
```

## Hex Integer enums
Since hex integers are treated as normal integers at runtime, you can mix and match hex integers and regular integers in enums. The numeric value of a hex integer will be considered when incrementing the next enum member value as well.
```brighterscript
enum Colors
    lessRed = 254
    red = &HFF ' this is 255
    moreRed
end enum
sub main()
    print Colors.lessRed
    print Colors.red
    print Colors.moreRed
end sub
```

transpiles to

```brightscript
sub main()
    print 254
    print &HFF
    print 256
end sub
```
Notice how `Colors.moreRed` is one number higher than the 255 used in `Colors.red`?

## Other enum types
You define an enum using any numeric or string literal values. Here are some other examples:
```vb
enum Floats
    value = 1.2
end enum

enum Doubles
    value = 2.3#
end enum

enum LongInteger
    value = 9876543210&
end enum
```


## Enum members must all be the same type
Due to the BrightScript strict runtime type system, you cannot mix and match different enum member types, because the most common use case for enums is to compare one value to another, which might result in a runtime error when comparing string and float for example.
```vb
enum Direction
    up = "up"
    down = 2 'this is an error
end enum
sub main()
    print Direction.up = Direction.down ' runtime error: Type Mismatch. Operator "=" can't be applied to "String" and "Integer".
end sub
```
