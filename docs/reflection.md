# Reflection
BrighterScript provides some basic reflection support to help with class and function discovery. Plain BrightScript does not offer any type of function discovery, so BrighterScript had to get creative in the way we handle reflection. 

## Reflection with BrightScript projects
Unfortunately, BrighterScript reflection is completely dependent on some automation within the BrighterScript transpiler. This means that you cannot have reflection or discovery of classes or functions from projects that were not transpiled by BrighterScript. Until BrightScript supports native function discovery, there is no way around this.

## Function and class discovery (supported cross-project)
Each BrighterScript namespace is responsible for declaring all of the classes and methods that are defined within it. In this way, we can prevent collisions between multiple BrightScript projects or libraries and support interoperability between them. However, this doees mean you need to know the namespace of the object you are searching for. 

