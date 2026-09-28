# BrighterScript Imports

Managing script tags in component XML files can be tedius and time consuming. BrighterScript provides the `import` statement, which can be added to the top of your `.bs` files. Any xml file that includes that `.bs` file will automatically have all of its imports added as `<script` includes.

## Basic example
**src/components/Widget.bs**
```BrighterScript
import "pkg:/source/lib.bs"

function Init()
    SomeFunctionFromLib()
end function
```

transpiles to
**pkg:/components/Widget.brs**
```BrightScript
'import "pkg:/source/lib.bs"

function Init()
    SomeFunctionFromLib()
end function
```

**pkg:/components/Widget.xml**
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="BaseScene" extends="Scene">
  <children>
    <Rectangle id="myRectangle" color="#FF0000" width="1920" height="1080" opacity=".6" translation="[0,0]" />
  </children>
  <script uri="Widget.brs" />
  <script uri="pkg:/source/lib.brs" />
</component>
```


## Type-only imports
Sometimes a file declares an interface or enum right next to the functions that use it. Other files often only need the *types* from that file, but a regular `import` would also bring along all of its runtime code (and, for component files, cause `Duplicate function implementation` errors for functions like `init`).

The `import type` statement solves this. It makes the **interfaces, enums and type aliases** from the imported file available for type checking, but does not include any of its runtime code:

- functions, classes and consts from the file are *not* available, and referencing them produces a diagnostic explaining why
- the file's own imports are treated as type-only as well
- the file is *not* added to the component xml as a `<script>` tag, since no runtime code is needed
- if the same file is also imported normally somewhere in the scope, the regular import wins and everything is available

**pkg:/components/Button.bs**
```BrighterScript
interface ButtonBase
    text as string
end interface

enum ButtonStyle
    primary = "primary"
    secondary = "secondary"
end enum

sub init()
end sub

function createButton(text as string) as ButtonBase
    return { text: text }
end function
```

**pkg:/components/MainMenu.bs**
```BrighterScript
import type "pkg:/components/Button.bs"

'no "duplicate function named init" diagnostic
sub init()
    button = { text: "Play" } as ButtonBase
    style = ButtonStyle.primary

    'error: Cannot find name 'createButton'. It is declared in 'pkg:/components/Button.bs', which is only imported as a type...
    other = createButton("Other")
end sub
```

transpiles to
**pkg:/components/MainMenu.brs**
```BrightScript
'import type "pkg:/components/Button.bs"

sub init()
    button = {
        text: "Play"
    }
    style = "primary"
    other = createButton("Other")
end sub
```

**pkg:/components/MainMenu.xml**
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MainMenu" extends="Group">
  <script uri="MainMenu.brs" />
  <script uri="pkg:/source/bslib.brs" />
</component>
```

Note that a file is only validated in the scopes where it is included normally (via a `<script>` tag, a regular `import`, or by living in `pkg:/source`). A file that is only ever referenced through `import type` statements is not validated in those scopes.

Classes are not currently available through `import type`, since they produce runtime code.
