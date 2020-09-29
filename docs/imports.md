# Imports
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

