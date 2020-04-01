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

## Constructor
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

