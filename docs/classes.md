# BrighterScript Classes

Traditional BrightScript supports object creation (see [roAssociativeArray](https://developer.roku.com/docs/references/brightscript/components/roassociativearray.md)), but these can get a bit complicated at times, are generally created in a factory function. These objects are also difficult to track from a type-checking perspective, as their shape can morph over time. In BrighterScript, you can declare actual classes, and compile them into pure BrightScript which can be used on any Roku device.

## Classes
Here's an example of a simple BrighterScript class

```vb
class Animal
    public name as string

    public function walk()

    end function

end class
```

And here's the transpiled BrightScript code

```BrightScript
sub __Animal_method_new()
    m.name = invalid
end sub
function __Animal_method_walk()
end function
function __Animal_builder()
    instance = {}
    instance.new = __Animal_method_new
    instance.walk = __Animal_method_walk
    return instance
end function
function Animal()
    instance = __Animal_builder()
    instance.new()
    return instance
end function
```

Notice that there are four functions created in the transpiled code for the `Animal` class:
- At runtime, BrighterScript classes are built in two steps in order to support class inheritance. The first step uses the `__ClassName_builder()` method to create the skeleton structure of the class. Then the class's constructor function will be run. Child classes will call the parent's `__ParentClassName_builder()` method, then rewrite overridden methods, and then call the child's constructor (without calling the parent constructor). Take a look at the transpiled output of the other examples below for more information on this.
- Class methods are hoisted as named functions, to prevent an excessive amount of "$anon_..." functions in stack traces, crash logs, and profiler outputs.


## Inheritance
In BrighterScript, we can use patterns common to other object-oriented languages such as using inheritance to create a new class based off of an existing class.
```BrighterScript
class Animal
    sub new(name as string)
        m.name = name
    end sub

    name as string

    sub move(distanceInMeters as integer)
        print m.name + " moved " + distanceInMeters.ToStr() + " meters"
    end sub
end class

class Duck extends Animal
    override sub move(distanceInMeters as integer)
        print "Waddling..."
        super.move(distanceInMeters)
    end sub
end class

class BabyDuck extends Duck
    override sub move(distanceInMeters as integer)
        super.move(distanceInMeters)
        print "Fell over...I'm new at this"
    end sub
end class

sub Main()
    smokey = new Animal("Smokey")
    smokey.move(1)
    '> Bear moved 1 meters

    donald = new Duck("Donald")
    donald.move(2)
    '> Waddling...\nDonald moved 2 meters

    dewey = new BabyDuck("Dewey")
    dewey.move(3)
    '> Waddling...\nDewey moved 2 meters\nFell over...I'm new at this
end sub
```
<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Animal_method_new(name as string)
    m.name = invalid
    m.name = name
end sub
sub __Animal_method_move(distanceInMeters as integer)
    print m.name + " moved " + distanceInMeters.ToStr() + " meters"
end sub
function __Animal_builder()
    instance = {}
    instance.new = __Animal_method_new
    instance.move = __Animal_method_move
    return instance
end function
function Animal(name as string)
    instance = __Animal_builder()
    instance.new(name)
    return instance
end function
sub __Duck_method_new(name as string)
    m.super0_new(name)
end sub
sub __Duck_method_move(distanceInMeters as integer)
    print "Waddling..."
    m.super0_move(distanceInMeters)
end sub
function __Duck_builder()
    instance = __Animal_builder()
    instance.super0_new = instance.new
    instance.new = __Duck_method_new
    instance.super0_move = instance.move
    instance.move = __Duck_method_move
    return instance
end function
function Duck(name as string)
    instance = __Duck_builder()
    instance.new(name)
    return instance
end function
sub __BabyDuck_method_new(name as string)
    m.super1_new(name)
end sub
sub __BabyDuck_method_move(distanceInMeters as integer)
    m.super1_move(distanceInMeters)
    print "Fell over...I'm new at this"
end sub
function __BabyDuck_builder()
    instance = __Duck_builder()
    instance.super1_new = instance.new
    instance.new = __BabyDuck_method_new
    instance.super1_move = instance.move
    instance.move = __BabyDuck_method_move
    return instance
end function
function BabyDuck(name as string)
    instance = __BabyDuck_builder()
    instance.new(name)
    return instance
end function

sub Main()
    smokey = Animal("Smokey")
    smokey.move(1)
    '> Bear moved 1 meters
    donald = Duck("Donald")
    donald.move(2)
    '> Waddling...\nDonald moved 2 meters
    dewey = BabyDuck("Dewey")
    dewey.move(3)
    '> Waddling...\nDewey moved 2 meters\nFell over...I'm new at this
end sub
```
</details>


## Constructor function
The constructor function for a class is called `new`.

```vb
class Duck
    sub new(name as string)
        m.name = name
    end sub

    name as string
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Duck_method_new(name as string)
    m.name = invalid
    m.end sub = invalid
    m.name = name
end sub
function __Duck_builder()
    instance = {}
    instance.new = __Duck_method_new
    return instance
end function
function Duck(name as string)
    instance = __Duck_builder()
    instance.new(name)
    return instance
end function
```
</details>

### Constructor function with inheritance
When constructing a child that inherits from a base class, the first call in the child's constructor must be a call to the parent's constructor

```vb
class Duck
    sub new(name as string)
        m.name = name
    end sub
    name as string
end class

class BabyDuck extends Duck
    sub new(name as string, age as integer)
        'the first line in this constructor must be a call to super()
        super(name)
        m.age = age
    end sub
    age as integer
end class
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Duck_method_move(name as string)
    m.name = invalid
    m.name = name
end sub
function __Duck_builder()
    instance = {}
    instance.new = __Duck_method_move
    return instance
end function
function Duck(name as string)
    instance = __Duck_builder()
    instance.new(name)
    return instance
end function
sub __BabyDuck_method_move(name as string, age as integer)
    m.super0_new()
    m.age = invalid
    'the first line in this constructor must be a call to super()
    m.super0_new(name)
    m.age = age
end sub
function __BabyDuck_builder()
    instance = __Duck_builder()
    instance.super0_new = instance.new
    instance.new = __BabyDuck_method_move
    return instance
end function
function BabyDuck(name as string, age as integer)
    instance = __BabyDuck_builder()
    instance.new(name, age)
    return instance
end function
```
</details>

## Overrides
Child classes can override methods on parent classes. In this example, the `BabyDuck.Eat()` method completely overrides the parent method. Note: the `override` keyword is mandatory, and you will get a compile error if it is not included in the child class and there is a matching method on the base class. Also, you will get a compile error if the override keyword is present in a child class, but that method doesn't exist in the parent class.

```vb
class Duck
    sub Eat()
        print "Ate all the food"
    end sub
end class

class BabyDuck
    override sub Eat()
        print "Ate half the food, because I'm a baby duck"
    end sub
end sub

```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Duck_method_new()
end sub
sub __Duck_method_Eat()
    print "Ate all the food"
end sub
function __Duck_builder()
    instance = {}
    instance.new = __Duck_method_new
    instance.Eat = __Duck_method_Eat
    return instance
end function
function Duck()
    instance = __Duck_builder()
    instance.new()
    return instance
end function
sub __BabyDuck_method_new()
end sub
sub __BabyDuck_method_Eat()
    print "Ate half the food, because I'm a baby duck"
end sub
function __BabyDuck_builder()
    instance = {}
    instance.new = __BabyDuck_method_new
    instance.super1_Eat = instance.Eat
    instance.Eat = __BabyDuck_method_Eat
    return instance
end function
function BabyDuck()
    instance = __BabyDuck_builder()
    instance.new()
    return instance
end function
```
</details>

### Calling parent method from child
You can also call the original methods on the base class from within an overridden method on a child class.

```vb
class Duck
    public sub walk(meters as integer)
        print "Walked " + meters.ToStr() + " meters"
    end sub
end class

class BabyDuck extends Duck
    public override sub walk(meters as integer)
        print "Tripped"
        super.walk(meters)
    end sub
end class

```
<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Duck_method_new()
end sub
sub __Duck_method_walk(meters as integer)
    print "Walked " + meters.ToStr() + " meters"
end sub
function __Duck_builder()
    instance = {}
    instance.new = __Duck_method_new
    instance.walk = __Duck_method_walk
    return instance
end function
function Duck()
    instance = __Duck_builder()
    instance.new()
    return instance
end function
sub __BabyDuck_method_new()
    m.super0_new()
end sub
sub __BabyDuck_method_walk(meters as integer)
    print "Tripped"
    m.super0_walk(meters)
end sub
function __BabyDuck_builder()
    instance = __Duck_builder()
    instance.super0_new = instance.new
    instance.new = __BabyDuck_method_new
    instance.super0_walk = instance.walk
    instance.walk = __BabyDuck_method_walk
    return instance
end function
function BabyDuck()
    instance = __BabyDuck_builder()
    instance.new()
    return instance
end function
```
</details>

## Public by default
Class fields and methods are public by default, which aligns with the general BrightScript approach that "everything is public".

```vb
class Person
    'defaults to public
    name as string

    'specified private
    private socialSecurityNumber

    'defaults to public
    function getName()
        return m.name
    end function

    'specified private
    private sub setSocialSecurityNumber(value as string)
        m.socialSecurityNumber = value
    end sub
end class
```
<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Person_method_new()
    m.name = invalid
    m.socialSecurityNumber = invalid
end sub
function __Person_method_getName()
    return m.name
end function
sub __Person_method_setSocialSecurityNumber(value as string)
    m.socialSecurityNumber = value
end sub
function __Person_builder()
    instance = {}
    instance.new = __Person_method_new
    'defaults to public
    'specified private
    'defaults to public
    instance.getName = __Person_method_getName
    'specified private
    instance.setSocialSecurityNumber = __Person_method_setSocialSecurityNumber
    return instance
end function
function Person()
    instance = __Person_builder()
    instance.new()
    return instance
end function
```
</details>

You will get compile-time errors whenever you access private members of a class from outside the class. However, be aware that this is only a compile-time restriction. At runtime, all members are public.

## Dynamic type by default
You can specify a type for class fields and a return type for methods. However, this is entirely optional. All fields and methods have a default type of `dynamic`. However, BrighterScript will attempt to infer the type from usage. Take this for example:

```BrighterScript
class Person
    'defaults to type "dynamic"
    name

    'infers type "integer"
    age = 12

    'infers type "integer"
    function getAge()
        return m.age
    end function
end class
```
<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Person_method_new()
    m.name = invalid
    m.age = 12
end sub
function __Person_method_getAge()
    return m.age
end function
function __Person_builder()
    instance = {}
    instance.new = __Person_method_new
    'defaults to type "dynamic"
    'infers type "integer"
    'infers type "integer"
    instance.getAge = __Person_method_getAge
    return instance
end function
function Person()
    instance = __Person_builder()
    instance.new()
    return instance
end function
```
</details>

## Property initialization
Like most other object-oriented classes, you can initialze a property with a default value.

```BrighterScript
class Duck
    name = "Donald"
    hasChildren = true
end class
```
<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Duck_method_new()
    m.name = "Donald"
    m.hasChildren = true
end sub
function __Duck_builder()
    instance = {}
    instance.new = __Duck_method_new
    return instance
end function
function Duck()
    instance = __Duck_builder()
    instance.new()
    return instance
end function
```
</details>


## Usage
In order to use a class, you need to construct one. Based on our person class above, you can create a new person like this:

```vb
donald = new Person("Donald")
daisy = new Person("Daisy")
```
<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
donald = Person("Donald")
daisy = Person("Daisy")
```
</details>


## Namespaces
Classes can also be contained within a namespace. At runtime, all namespace periods are replaced with underscores.

```BrighterScript
namespace Vertibrates.Birds
    class Animal
    end class

    class Duck extends Animal
    end class
end namespace
```
<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Vertibrates_Birds_Animal_method_new()
end sub
function __Vertibrates_Birds_Animal_builder()
    instance = {}
    instance.new = __Vertibrates_Birds_Animal_method_new
    return instance
end function
function Vertibrates_Birds_Animal()
    instance = __Vertibrates_Birds_Animal_builder()
    instance.new()
    return instance
end function
sub __Vertibrates_Birds_Duck_method_new()
    m.super0_new()
end sub
function __Vertibrates_Birds_Duck_builder()
    instance = __Vertibrates_Birds_Animal_builder()
    instance.super0_new = instance.new
    instance.new = __Vertibrates_Birds_Duck_method_new
    return instance
end function
function Vertibrates_Birds_Duck()
    instance = __Vertibrates_Birds_Duck_builder()
    instance.new()
    return instance
end function
```
</details>


## Instance binding
As you would expect, methods attached to a class will have their `m` assigned to that class instance whenever they are invoked through the object. (i.e. `someClassInstance.doSomething()`. However, keep in mind that functions themselves retain no direct knowledge of what object they are bound to.

This is no different than the way plain BrightScript functions and objects interact, but it was worth mentioning that classes cannot mitigate this fundamental runtime limitation.

Consider this example:

```brighterscript
class Person
    sub new(name as string)
        m.name = name
    end sub
    sub sayHello()
        print m.name
    end sub
end class

sub main()
    m.name = "Main method"
    bob = new SomeClass("bob")

    'works as expected...the `m` reference is `bob`
    bob.sayHello() 'prints "Bob"

    'lift the function off of `bob`
    sayHello = bob.sayHello

    '`m` is actually the global `m` scope
    sayHello() ' prints "Main method"
end sub
```
<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Person_method_new(name as string)
    m.name = name
end sub
sub __Person_method_sayHello()
    print m.name
end sub
function __Person_builder()
    instance = {}
    instance.new = __Person_method_new
    instance.sayHello = __Person_method_sayHello
    return instance
end function
function Person(name as string)
    instance = __Person_builder()
    instance.new(name)
    return instance
end function

sub main()
    m.name = "Main method"
    bob = SomeClass("bob")
    'works as expected...the `m` reference is `bob`
    bob.sayHello() 'prints "Bob"
    'lift the function off of `bob`
    sayHello = bob.sayHello
    '`m` is actually the global `m` scope
    sayHello() ' prints "Main method"
end sub
```
</details>


## Optional fields

Classes can include optional fields, denoted with the keyword `optional` before the name. If a class has an optional field, it signifies that the value of the field may be `invalid`. Optional fields in a class do not change how the class or its members are validated.

```brighterscript
class Video
    url as string
    length as float
    optional subtitleUrl as string
    optional rating as string
    optional genre as string
end class
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```BrightScript
sub __Video_method_new()
    m.url = invalid
    m.length = invalid
    m.subtitleUrl = invalid
    m.rating = invalid
    m.genre = invalid
end sub
function __Video_builder()
    instance = {}
    instance.new = __Video_method_new
    return instance
end function
function Video()
    instance = __Video_builder()
    instance.new()
    return instance
end function
```
</details>
