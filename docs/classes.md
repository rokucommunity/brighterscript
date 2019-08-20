# Classes
Traditional BrightScript supports object creation (see [roAssociativeArray](https://developer.roku.com/docs/references/brightscript/components/roassociativearray.md)), but these can get a bit complicated at times, are generally created in a factory function. These objects are also difficult to track from a type-checking perspective, as their shape can morph over time. In BrighterScript, we allow developers to declare actual classes, and compile them into pure BrightScript which can be used on any Roku device.

## Classes
Here's an example of a simple BrighterScript class

```brighterscript
class Person
    public name as string

    public function sayHello()

    end function

end class
```

## Public by default
Class fields and methods are public by default, which aligns with the general BrightScript approach that "everything is public". 

```brighterscript
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

## Dynamic type by default
You can specify a type for class fields and a return type for methods. However, this is entirely optional. All fields and methods have a default type of `dynamic`. However, BrighterScript will attempt to infer the type from usage. Take this for example:

```brighterscript
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