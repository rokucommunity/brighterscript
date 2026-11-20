# Imports

Managing script tags in component XML files can be tedious and time consuming. BrighterScript provides the `import` statement, which can be added to the top of your `.bs` files. Any XML file that includes that `.bs` file automatically gets a `<script>` tag for each of its imports, and for their imports in turn. An import of a file that doesn't exist is reported as an error at compile time.

## Basic usage
**src/components/Widget.bs**
```BrighterScript
import "pkg:/source/lib.bs"

function Init()
    SomeFunctionFromLib()
end function
```

<details>
  <summary>View the transpiled BrightScript code</summary>

**pkg:/components/Widget.brs**
```BrightScript
'import "pkg:/source/lib.bs"

function Init()
    SomeFunctionFromLib()
end function
```

**pkg:/components/Widget.xml**
```xml {7}
<?xml version="1.0" encoding="utf-8" ?>
<component name="BaseScene" extends="Scene">
  <children>
    <Rectangle id="myRectangle" color="#FF0000" width="1920" height="1080" opacity=".6" translation="[0,0]" />
  </children>
  <script uri="Widget.brs" />
  <script uri="pkg:/source/lib.brs" />
</component>
```

</details>
