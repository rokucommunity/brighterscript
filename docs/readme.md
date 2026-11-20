# BrighterScript

BrighterScript is a superset of Roku's BrightScript language. It adds features like classes, namespaces, imports, enums and type annotations, and compiles them down to plain BrightScript, so your code runs on every Roku device with nothing extra to install.

The compiler is useful even if you never write a line of BrighterScript. It validates entire BrightScript projects too, so you find syntax errors, typos and calls to missing functions on your machine instead of on a device.

## Why BrighterScript?

- **Catch errors before you sideload.** The compiler checks your whole project at once, including the script references between your XML components and code files, and reports problems with their exact location.
- **Write less boilerplate.** Classes, namespaces, imports, template strings and modern operators cut out the repetitive code that BrightScript requires.
- **Adopt it a file at a time.** Every BrightScript file is already valid BrighterScript. Rename a file from `.brs` to `.bs` when you want the new features, and leave the rest alone.
- **Great editor support.** The [BrightScript Language extension](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript) for VS Code uses this compiler for real-time errors, completions, go-to-definition and more.
- **Extend it.** [Plugins](tooling/plugins.md) can add your own validations or rewrite code as it compiles.

## A quick look

Here's a small BrighterScript program:

```brighterscript
namespace catalog
    class Movie
        title as string
        rating as dynamic

        sub new(title as string, rating = invalid)
            m.title = title
            m.rating = rating
        end sub

        function describe() as string
            rating = m.rating ?? "not rated"
            return `${m.title} (${rating})`
        end function
    end class
end namespace

sub main()
    movie = new catalog.Movie("Big Buck Bunny")
    print movie.describe()
end sub
```

<details>
  <summary>View the transpiled BrightScript code</summary>

```brightscript
sub __catalog_Movie_method_new(title as string, rating = invalid)
    m.title = invalid
    m.rating = invalid
    m.title = title
    m.rating = rating
end sub
function __catalog_Movie_method_describe() as string
    rating = m.rating
    if rating = invalid then
        rating = "not rated"
    end if
    return (bslib_toString(m.title) + " (" + bslib_toString(rating) + ")")
end function
function __catalog_Movie_builder()
    instance = {}
    instance.new = __catalog_Movie_method_new
    instance.describe = __catalog_Movie_method_describe
    return instance
end function
function catalog_Movie(title as string, rating = invalid)
    instance = __catalog_Movie_builder()
    instance.new(title, rating)
    return instance
end function

sub main()
    movie = catalog_Movie("Big Buck Bunny")
    print movie.describe()
end sub
```

</details>

## Language features

- [Imports](language-features/imports.md): declare a script's dependencies in the script itself, instead of in XML `<script>` tags.
- [Namespaces](language-features/namespaces.md) and [Classes](language-features/classes.md): organize your code, with inheritance and access modifiers.
- [Interfaces](language-features/interfaces.md), [Enums](language-features/enums.md) and [Constants](language-features/constants.md): name your shapes and values, checked at compile time.
- [Template Strings](language-features/template-strings.md): ``print `hello ${name}` ``.
- [Ternary](language-features/ternary-operator.md), [Null-Coalescing](language-features/null-coalescing-operator.md) and [Spread](language-features/spread-operator.md) operators: `a ? b : c`, `a ?? b` and `[...a, ...b]`.
- [Callfunc Operator](language-features/callfunc-operator.md): `node@.someMethod()` instead of `node.callfunc("someMethod")`.
- [Select Case](language-features/select-case.md) statements and [Exceptions](language-features/exceptions.md) without an exception variable.
- A type system: [typed assignments](language-features/assignments.md), [typecasts](language-features/typecasts.md), [typed arrays](language-features/typed-arrays.md), [union](language-features/union-types.md) and [intersection](language-features/intersection-types.md) types, [type statements](language-features/type-statements.md) and [function types](language-features/function-types.md). You can even [type check plain BrightScript](language-features/type-checking-without-transpile.md) with comments.
- [Regular Expression Literals](language-features/regex-literals.md), [Source Literals](language-features/source-literals.md), [Computed Property Names](language-features/computed-property-names.md) and [Annotations](language-features/annotations.md).

## Used by

BrighterScript is used to build apps for Roku by teams like these. It also powers the [BrightScript Language](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript) extension for VS Code and the [maestro framework](https://github.com/georgejecook/maestro-roku).

<p class="used-by">
    <a href="https://www.fubo.tv/"><img height="38" alt="fubo" src="https://user-images.githubusercontent.com/2544493/192530108-eb470b85-e687-4575-af69-254aab13428c.png" /></a>
    <a href="mailto:chris@inverted-solutions.com"><img height="38" alt="Inverted Solutions" src="https://user-images.githubusercontent.com/2544493/197794500-2bac4903-ed00-463a-b243-24c68fba7962.png" /></a>
    <a href="https://www.applicaster.com/"><img height="38" alt="Applicaster" src="https://user-images.githubusercontent.com/2544493/192591901-20441fc8-3c6c-45ea-8851-b22430e6fb8e.png" /></a>
    <a href="https://www.redspace.com/"><img height="38" alt="REDspace" src="https://user-images.githubusercontent.com/2544493/195908446-8d9652f8-9877-426f-b3c6-09119d788fd8.png" /></a>
    <a href="https://tantawowa.com/"><img height="38" alt="Tantawowa" src="https://user-images.githubusercontent.com/2544493/197795138-2ec870db-71fe-49e3-a014-692a3f31e6aa.png" /></a>
    <a href="https://www.miraclechannel.ca/corcoplus"><img height="38" alt="CorcoPlus" src="https://user-images.githubusercontent.com/2544493/192593254-f2a32cd4-0482-40de-830d-c1d09690c46b.png" /></a>
    <a href="https://digitalpictureframe.tv"><img height="38" alt="Digital Picture Frame" src="https://s3.us-east-1.wasabisys.com/tv.digitalpictureframe.assets/logo-wide.png" /></a>
    <a href="https://www.haystack.tv/"><img height="38" alt="Haystack TV" src="https://user-images.githubusercontent.com/2544493/192610056-d1b5a382-edf4-47b9-a6a5-d2d3ee9094cb.png" /></a>
    <a href="https://www.tksssoftware.com/"><img height="38" alt="TKSS Software Inc" src="https://github.com/user-attachments/assets/332d692f-7386-495d-b29d-c2ed7d3d2e2f" /></a>
</p>

Using BrighterScript in your project? [Open an issue](https://github.com/rokucommunity/brighterscript/issues/new) to have your logo added.

## Get help

- Ask questions in the [Roku Developers Slack](https://join.slack.com/t/rokudevelopers/shared_invite/zt-4vw7rg6v-NH46oY7hTktpRIBM_zGvwA).
- Report bugs and request features in [GitHub issues](https://github.com/rokucommunity/brighterscript/issues).
