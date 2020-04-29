# Imports
Managing script tags in component XML files can be tedius and time consuming. BrighterScript provides the `import` statement, which can be added to the top of your `.bs` files. Any xml file that includes that `.bs` file will automatically have all of its imports added as `<script` includes.

## Basic example
```BrighterScript
import "lib.bs"
function DoSomething()
    SomeFunctionFromLib()
end function
```
