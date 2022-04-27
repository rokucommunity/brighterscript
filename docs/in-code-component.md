# Components
You can define a component in code, similar to how you would define a class.

## Basic usage
```vb
component MoviePoster extends roSGNode.Poster
    sub init()
        print "MoviePoster init()"
    end sub
end component
```


<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster">
    <script uri="MoviePoster.brs" />
</component>
```

`components/MoviePoster.brs`

```vb
sub init()
    print "MoviePoster init()"
end sub
```

</details>

<br/>

## Private properties and functions
Private properties are written to `m`. Private functions are transpiled to scope-level functions (i.e. not written to m) and we will remove the `m.` when calling those functions.
```vb
component MoviePoster extends roSGNode.Poster
    sub init()
        m.toggleSubtitles()
    end sub
    private areSubtitlesEnabled as boolean = true
    private sub toggleSubtitles()
        m.areSubtitlesEnabled = not m.areSubtitlesEnabled
    end sub
end component
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster">
    <script uri="MoviePoster.brs" />
</component>
```

`components/MoviePoster.brs`

```vb
sub init()
    m.areSubtitlesEnabled = true
    toggleSubtitles()
end sub
sub toggleSubtitles()
    m.areSubtitlesEnabled = not m.areSubtitlesEnabled
end sub
```

</details>


## Interface fields and functions
You can define interface fields and functions by declaring them as `public`.

**NOTE:** unlike private properties, these public fields must be accessed through `m.top` which aligns with Roku's SceneGraph design.
```vb
component MoviePoster extends roSGNode.Poster
    'this is an interface field
    public title as string
    private isPlaying as boolean

    ' this is an interface function
    public sub play()
        print "Play movie " + m.top.title
        m.isPlaying = true
    end sub
end component
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster">
    <interface>
        <field id="title" type="string" />
        <function name="play" />
    </interface>
    <script uri="MoviePoster.brs" />
</component>
```

`components/MoviePoster.brs`

```vb
sub play()
    print "Play movie " + m.top.title
    m.isPlaying = true
end sub
```

</details>

## Interface field shorthand
The Roku SceneGraph design is a bit unique in that `m` and `m.top` are both sort of `this` style objects. To simplify the concept, we have added a new flag that will expose all of the `m.top` fields and methods onto `m`. You can enable that with the `enableComponentInterfaceShortand` bsconfig property.

Keep in mind, enabling this property will add all the roSGNode properties and methods (as well as all ancestor properties/methods) to m, and thus prevent you from naming your variables with the same name. Probably not a big deal, but it's worth noting.

Consider the following example. We print `m.title`, but it gets transpiled to `m.top.title` because we know for certain that it's a public field.

`bsconfig.json`
```js
{
    //makes all known m.top interface fields and functions avaible on m for `component` defs
    "enableComponentInterfaceShortand": true
}
```

`components/MoviePoster.bs`
```vb
component MoviePoster extends roSGNode.Poster
    sub init()
        print "Play movie " + m.title
        m.isPlaying = true
    end sub

    public title as string
    private isPlaying as boolean
end component
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster">
    <interface>
        <field id="title" type="string" />
    </interface>
    <script uri="MoviePoster.brs" />
</component>
```

`components/MoviePoster.brs`

```vb
sub init()
    print "Play movie " + m.top.title
    m.isPlaying = true
end sub
```

</details>


## XML Template
You can define an xml template inline using the `@Template` annotation.
```vb
@Template(`
    <component>
        <children>
            <Rectangle id="bottomBar" />
        </children>
    </component>
`)
component MoviePoster extends roSGNode.Poster
end component
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster">
    <children>
        <Rectangle id="bottomBar" />
    </children>
</component>
```
</details>
<br/>

### XML Template Shorthand
The `<component>` and `<children>` tags can be omitted if you don't need to customize them.

```vb
@Template(`
    <Rectangle id="bottomBar"/>
`)
component MoviePoster extends roSGNode.Poster
end component
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster">
    <children>
        <Rectangle id="bottomBar" />
    </children>
</component>
```
</details>
<br/>


### Loading XML template from file
XML component templates can also be loaded from another file by using the `@TemplateUrl()` annotation.

`components/MoviePoster.bs`
```vb
@TemplateUrl("./MoviePoster.xml")
component MoviePoster extends roSGNode.Poster
    sub init()
        print "MoviePoster"
    end sub
end component
```

`components/MoviePoster.xml`
```xml
<Rectangle id="bottomBar" />
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster">
    <children>
        <Rectangle id="bottomBar" />
    </children>
    <interface>
        <field id="asdf" onchange="functionCallback" type="string" />
    </interface>
    <script uri="MoviePoster.brs" />
</component>
```

`components/MoviePoster.brs`
```vb
sub init()
    print "MoviePoster"
end sub
```
</details>
<br/>

## InitialFocus
To set `initialFocus`, you can add that to the template's `<component` tag
```vb
@Template(`
    <component initialFocus="bottomBar">
        <children>
            <Rectangle id="bottomBar"/>
        </children>
    </component>
`)
component MoviePoster extends roSGNode.Poster
end component
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster" initialFocus="bottomBar">
    <children>
        <Rectangle id="bottomBar" />
    </children>
</component>
```
</details>
<br/>

You could also do this as an annotation
```vb
@Template(`
    <Rectangle id="bottomBar"/>
`)
@InitialFocus("bottomBar")
component MoviePoster extends roSGNode.Poster
end component
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster" initialFocus="bottomBar">
    <children>
        <Rectangle id="bottomBar" />
    </children>
</component>
```
</details>
<br/>


## Field Annotations
You can preceed a field with annotations that describe additional features of the field.

### @Alias
```vb
@Template(`
    <Label id="title" />
    <Label id="titleCopy" />
`)
component MoviePoster extends roSGNode.Poster
    'you can use the any of these patterns, or a combination of them together
    @Alias("title.text")
    @Alias("titleCopy.text")

    @Alias("title.text,titleCopy.text")

    @Alias("title.text", "titleCopy.text")
    public minutes as string
end component
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster">
    <interface>
        <field id="title" type="string" alias="title.text,titleCopy.text" />
    </interface>
</component>
```
</details>
<br/>

### @OnChange
```vb
@Template(`
    <Label id="title" />
`)
component MoviePoster extends roSGNode.Poster
    @Onchange(m.onMinutesChange)
    public minutes as string
    @Onchange(externalFunction)
    @Onchange("externalFunction")
    public seconds as string

    private function onMinutesChange()
        print "minutes changed!"
    end function

end component

function externalFunction()
end function
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster">
    <interface>
        <field id="title" type="string" onchange="onMinutesChange" />
        <field id="seconds" type="string" onchange="externalFunction" />
    </interface>
    <script uri="MoviePoster.brs" />
</component>
```

`components/MoviePoster.brs`
```vb
function onMinutesChange()
    print "minutes changed!"
end function

function externalFunction()
end function
```
</details>
<br/>


## Inheritance
Components also support overloaded methods. This works by copying and renaming parent overridden functions into child components. We will only copy functions that are explicitly called by the child.
```vb
component MoviePoster extends roSGNode.Poster
    protected function play()
        print "MoviePoster play()"
    end function
end component

component TinyMoviePoster extends MoviePoster
    private override function play()
        super.play()
        print "TinyMoviePoster play()"
    end function
end component
```

<details>
  <summary>View the transpiled BrightScript code</summary>

`components/MoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MoviePoster" extends="Poster">
    <script uri="MoviePoster.brs" />
</component>
```

`components/MoviePoster.brs`
```vb
function play()
    print "MoviePoster play()"
end function
```

`components/TinyMoviePoster.xml`
```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="TinyMoviePoster" extends="Poster">
    <script uri="TinyMoviePoster.brs" />
</component>
```

`components/TinyMoviePoster.brs`
```vb
function play()
    MoviePoster_play()
    print "TinyMoviePoster play()"
end function

function MoviePoster_play()
    print "MoviePoster play()"
end function
```
</details>
<br/>
