# BrighterScript Interfaces

Not to be confused with SceneGraph interfaces (see [<interfaces>](https://developer.roku.com/en-ca/docs/references/scenegraph/xml-elements/interface.md)), BrighterScript introduces the `interface` keyword to describe the public methods and/or fields available on a [class](class.md). This has the benefit of allowing type-checking and validation on different classes as long as they expose the same public functions.

## Interfaces

Interfaces are declared similarly to classes, with the exception of not needing any implementation fo methods, no access modifiers (i.e. nothing is `private` in an `interface`), and nothing is initialized.

```vb
interface Vehicle
    name as string

    sub driveKm(distanceKm as float)
end interface
```

Since an `interface` is simply a description of a class, it is not transpiled. Interfaces are only useful at compile-time to do type checking and validation. They will not result in any additional transpiled code.

## Type Checking

BrighterScript will validate function calls that use interface types.

For example, (using the same `Vehicle` interface above), there may be two classes that implement the same interface, `Car` and `Truck`:

```vb
class Car
    name as string

    sub new(name as string)
        m.name = name
    end sub

    sub driveKm(distanceKm as float)
        ' some implementation
    end sub
end class

class Truck
    name as string = "F150"

    sub driveKm(distanceKm as float)
        ' some implementation
    end sub
end class
```

Then we could create a function that takes a `Vehicle` parameter and either a `Car` or a `Truck` would pass validation:

```vb

sub driveVehicle100Km(someVehicle as Vehicle)
    print `Driving ${someVehicle.name} 100 km`
    someVehicle.distanceKm(100)
end sub


sub main()
    bmw = new Car("BMW")
    ford = new Truck()

    driveVehicle100Km(bmw) ' bmw is a Car, which implements Vehicle
    driveVehicle100Km(ford) ' ford is a Truck, which implements Vehicle
end sub
```
