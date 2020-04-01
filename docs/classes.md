# Classes
Traditional BrightScript supports object creation (see [roAssociativeArray](https://developer.roku.com/docs/references/brightscript/components/roassociativearray.md)), but these can get a bit complicated at times, are generally created in a factory function. These objects are also difficult to track from a type-checking perspective, as their shape can morph over time. In BrighterScript, you can declare actual classes, and compile them into pure BrightScript which can be used on any Roku device.

## Classes
Here's an example of a simple BrighterScript class

```BrighterScript
class Person
    public name as string

    public function sayHello()

    end function

end class
```
<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
function Person()
    instance = {
        name: invalid,
        sayHello: function()
        end function,
    }
    return instance
end function
```
</details>

## Inheritance
In BrighterScript, we can use patterns common to other object-oriented languages. A common pattern is being able to use inheritance to create a new class based off of an existing class.
```BrighterScript
class Animal
    name as string
    sub move(distanceInMeters as integer)
        print m.name + " moved " + distanceInMeters.ToStr() + " meters"
    end sub
end class

class Duck extends Animal
    sub move(distanceInMeters as integer)
        print "Waddling..."
        super.move(distanceInMeters)
    end sub
end class

class BabyDuck extends Duck
    sub move(distanceInMeters as integer)
        super.move(distanceInMeters)
        print "Fell over...I'm still new at this"
    end sub
end class
```
<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
function Animal()
    instance = {}
    instance.name = invalid,
    instance.move = sub(distanceInMeters as integer)
        print m.name + " moved " + distanceInMeters.ToStr() + " meters"
    end sub
    return instance
end function

function Duck()
    instance = Animal()
    instance.super0_move = instance.move
    instance.move = sub(distanceInMeters as integer)
        print "Waddling..."
        m.super0_move(distanceInMeters)
    end sub
    return instance
end function

function BabyDuck()
    instance = Duck()
    instance.super1_move = instance.move
    instance.move = sub(distanceInMeters as integer)
        instance.super1_move(distanceInMeters)
    end sub
    return instance
```
</details>


## Constructor function
The constructor function for a class is called `new`. 

```BrighterScript
class Person
    sub new(name as string)
        m.name = name
    end sub

    name as string
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
function Person(name as string)
    instance = {
        name: invalid
        sayHello: function()
        end function,
    }
    
    'sub new
    instance.name = name
    'end sub

    return instance
end function
```
</details>

### Constructor function with inheritance
When constructing a child that inherits from a base class, the first call in the child's constructor must be a call to the parent's constructor

```BrighterScript
class Person
    sub new(name as string)
        m.name = name
    end sub
    name as string
end class

class ConstructionWorker
    sub new(name as string, age)
        'the first line in this constructor must be a call to super()
        super(name)
        m.age = age
    end sub
    age as integer
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
function Person(name as string)
    instance = {}
    instance.name = invalid
   
    'sub new
    instance.name = name
    'end sub

    return instance
end function

function ConstructionWorker(name as string, age as integer)
    'sub new
    instance = Person(name)
    instance.age = age
    'end sub
end function

```
</details>


## Public by default
Class fields and methods are public by default, which aligns with the general BrightScript approach that "everything is public". 

```BrighterScript
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
function Person()
    instance = {
        'defaults to public
        name: invalid,
        
        'specified private
        socialSecurityNumber: invalid,
        
        'defaults to public
        getName: function()
            return m.name
        end function,

        'specified private
        setSocialSecurityNumber(value as string)
            m.socialSecurityNumber = value
        end sub
    }
    return instance
end function
```
</details>

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
function Person()
    instance = {
       'defaults to type "dynamic"
        name: invalid,

        'infers type "integer"
        age: 12,

        'infers type "integer"
        getAge: getAge()
            return m.age
        end function
    }
    return instance
end function
```
</details>

## Usage
In order to use a class, you need to construct one. Based on our person class above, you can create a new person like this:

```BrighterScript
jack = new Person("Jack")
jill = new Person("Jill")
```
<details>
  <summary>View the transpiled BrightScript code</summary>
  
```BrightScript
jack = Person("Jack")
jill = Person("Jill")
```
</details>
