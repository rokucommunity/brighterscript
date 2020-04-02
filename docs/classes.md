# Classes
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
  
```vb
function Animal$Build()
    instance = {}
    instance.name = invalid
    instance.walk = function()
    end function
    return instance
end function

function Animal()
    instance = Animal$Build()
    return instance
end function
```

Notice that there are two functions created in the transpiled code for the `Animal` class. At runtime, BrighterScript classes are built in two steps in order to support class inheritance. The first step uses the `ClassName$Build()` method to create the skeleton structure of the class. Then the class's constructor function will be run. Child classes will call the parent's `ParentClassName$Build()` method, then rename overridden  methods, and then call the child's constructor (without calling the parent constructor). Take a look at the transpiled output of the other examples below for more information on this. 


## Inheritance
In BrighterScript, we can use patterns common to other object-oriented languages such as using inheritance to create a new class based off of an existing class.
```vb
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
        print "Fell over...I'm still new at this"
    end sub
end class

sub Main()
    new Animal("Bear").move(1) 
    '> Bear moved 1 meters

    new Duck("Donald").move(2) 
    '> Waddling...\nDonald moved 2 meters

    new BabyDuck("Dewey").move(3) 
    '> Waddling...\nDewey moved 2 meters\nFell over...I'm still new at this
end sub
```
<details>
  <summary>View the transpiled BrightScript code</summary>
  
```vb
function Animal$Build()
    instance = {}
    instance.new = sub(name as string)
        m.Name = name
    end sub
    instance.name = invalid,
    instance.move = sub(distanceInMeters as integer)
        print m.name + " moved " + distanceInMeters.ToStr() + " meters"
    end sub
    return instance
end function
function Animal(name as string)
    instance = Animal$Build()
    instance.new(name)
    return instance
end function

function Duck$Build()
    instance = Animal$Build()
    instance.super0_move = instance.move
    instance.move = sub(distanceInMeters as integer)
        print "Waddling..."
        m.super0_move(distanceInMeters)
    end sub
    return instance
end function
function Duck(name as string)
    instance = Duck$Build()
    instance.new(name)
    return instance
end function

function BabyDuck$Build()
    instance = Duck$Build()
    instance.super1_move = instance.move
    instance.move = sub(distanceInMeters as integer)
        instance.super1_move(distanceInMeters)
    end sub
    return instance
end function
function BabyDuck(name as string)
    instance = BabyDuck$Build()
    instance.new(name)
    return instance
end function


sub Main()
    Animal("Bear").move(1) 
    '> Bear moved 1 meters

    Duck("Donald").move(2) 
    '> Waddling...\nDonald moved 2 meters

    BabyDuck("Dewey").move(3) 
    '> Waddling...\nDewey moved 2 meters\nFell over...I'm still new at this
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
  
```vb
function Duck$Build()
    instance = {}
    instance.new = sub(name as string)
        m.name = name
    end sub
    instance.name = invalid
    return instance
end function

function Duck(name as string)
    instance = Duck$Build()
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
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>
  
```vb
function Duck$Build
    instance = {}
    instance.new = sub(name as string)
        m.name = name
    end sub
    instance.name = invalid
    return instance
end function
function Duck(name as string)
    instance = Duck$Build()
    instance.new(name)
    return instance
end function

function BabyDuck$Build(name as string, age as integer)
    instance = Duck$Build()
    instance.super0_new = m.new
    instance.new = sub(name as string, age)
        m.super0_new(name)
    end sub
    instance.age = age
end function
function BabyDuck(name as string, age as integer)
    instance = BabyDuck$Build()
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
  
```vb
function Duck$Build
    instance = {}
    return instance
end function
function Duck(name as string)
    instance = Duck$Build()
    return instance
end function

function BabyDuck$Build(name as string, age as integer)
    instance = Duck$Build()
    instance.age = age
end function
function BabyDuck(name as string, age as integer)
    instance = BabyDuck$Build()
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
  
```vb
function Duck$Build
    instance = {}
    instance.walk = sub(meters as integer)
        print "Walked " + meters.ToStr() + " meters"
    end sub
    return instance
end function
function Duck(name as string)
    instance = Duck$Build()
    return instance
end function

function BabyDuck$Build(name as string, age as integer)
    instance = Duck$Build()
    instance.super0_Walk = instance.walk
    instance.walk = sub(meters as integer)
        print "Tripped"
        m.super0_walk(meters)
    end sub
end function
function BabyDuck(name as string, age as integer)
    instance = BabyDuck$Build()
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
  
```vb
function Person()
    instance = {}
    'defaults to public
    instance.name = invalid,
    
    'specified private
    instance.socialSecurityNumber = invalid
    
    'defaults to public
    instance.getName = function()
        return m.name
    end function

    'specified private
    instance.setSocialSecurityNumber = sub(value as string)
        m.socialSecurityNumber = value
    end sub
    return instance
end function
```
</details>

You will get compile-time errors whenever you access private members of a class from outside the class. However, be aware that this is only a compile-time restriction. At runtime, all members are public.

## Dynamic type by default
You can specify a type for class fields and a return type for methods. However, this is entirely optional. All fields and methods have a default type of `dynamic`. However, BrighterScript will attempt to infer the type from usage. Take this for example:

```vb
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
  
```vb
function Person()
    instance = {}

    'defaults to type "dynamic"
    instance.name = invalid

    'infers type "integer"
    instance.age = 12

    'infers type "integer"
    instance.getAge = function()
        return m.age
    end function
    return instance
end function
```
</details>

## Usage
In order to use a class, you need to construct one. Based on our person class above, you can create a new person like this:

```vb
jack = new Person("Jack")
jill = new Person("Jill")
```
<details>
  <summary>View the transpiled BrightScript code</summary>
  
```vb
jack = Person("Jack")
jill = Person("Jill")
```
</details>

