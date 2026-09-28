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
Sometimes a file declares an interface, enum or const right next to the functions that use it. Other files often only need those *types*, but a regular `import` would also bring along all of the file's runtime code (and, for component files, cause `Duplicate function implementation` errors for functions like `init`).

The `import type` statement solves this. It names the specific **interfaces, enums, consts and type aliases** you want from a file, optionally renaming them with `as`:

```BrighterScript
import type { ButtonBase, ButtonStyle as Style, Buttons.MAX as MaxButtons } from "pkg:/components/Button.bs"
```

- the imported file is **not** added to the scope, so none of its functions, classes or consts other than the ones named are available, and there are no function name collisions
- the imported file is **not** added to the component xml as a `<script>` tag, since no runtime code is needed
- imported enum members and consts are inlined as literals at transpile time, exactly like local ones
- imported names are local to the importing file. Other files in the same component need their own `import type`
- namespaced names are written in full (`Buttons.MAX`). Without an alias, the local name is the last part (`MAX`)
- like everything else in BrightScript, names are case insensitive: `import type { buttonbase }` imports `ButtonBase`, and `Style.primary`, `STYLE.PRIMARY` and `style.Primary` all refer to the same enum member. Because of this, two imported names (or aliases) in the same file cannot differ only by case; doing so produces a diagnostic
- naming something that does not exist, or that is a function or class, produces a diagnostic on the import

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
import type { ButtonBase, ButtonStyle as Style } from "pkg:/components/Button.bs"

'no "duplicate function named init" diagnostic
sub init()
    button = { text: "Play" } as ButtonBase
    buttonStyle = Style.primary

    'error: Cannot find function 'createButton' (Button.bs is not part of this scope)
    other = createButton("Other")
end sub
```

transpiles to
**pkg:/components/MainMenu.brs**
```BrightScript
'import type { ButtonBase, ButtonStyle as Style } from "pkg:/components/Button.bs"

sub init()
    button = {
        text: "Play"
    }
    buttonStyle = "primary"
    otherStyle = "primary"
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

Classes cannot be imported this way, since they produce runtime code.
