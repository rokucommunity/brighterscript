# Adding BrighterScript to an Existing Project

Every BrightScript file is already valid BrighterScript, so you don't need to rewrite anything to get started. You can add the compiler to an existing Roku project today, and then adopt BrighterScript features one file at a time. You can stop after any step and still have a working app.

## Before you start

You need [Node.js](https://nodejs.org/) installed. We'll work with a project laid out like this:

```
my-app/
├── package.json
└── src/
    ├── manifest
    ├── source/
    │   ├── main.brs
    │   └── utils.brs
    └── components/
        ├── HomeScene.xml
        └── HomeScene.brs
```

If your `manifest` is at the root of your repository instead of in a `src` folder, leave out the `rootDir` setting in your `bsconfig.json`.

## Step 1: Check your project for errors

Install BrighterScript as a dev dependency:

```bash
npm install brighterscript --save-dev
```

Then add a `bsconfig.json` next to your `package.json`. Write this one by hand instead of using `bsc --init`, so the build keeps the default output, a zip you can sideload the way you do today (see [Where the build goes](configuration.md#where-the-build-goes)):

```json title="bsconfig.json"
{
    "rootDir": "src"
}
```

Now run the compiler, without creating a package:

```bash
npx bsc --create-package false --copy-to-staging false
```

The compiler reads every file in your project, including the `<script>` tags in your component XML files, and reports any problems it finds. Most of the errors you'll see on a first run point to real bugs. For example, if `HomeScene.brs` calls a function from `utils.brs`, but `HomeScene.xml` doesn't include `utils.brs` in a `<script>` tag, the function won't exist when the component runs:

```bsc-output
src/components/HomeScene.brs:3:20 - error BS1140: Cannot find function 'formatTitle'

 3      m.title.text = formatTitle("Big Buck Bunny", 2008)
                       ~~~~~~~~~~~

     src/components/HomeScene.xml:2:18
     Not defined in scope 'components/HomeScene.xml'
```

Each component is checked on its own. It can use the functions from its own `<script>` tags and from the components it extends. The files in `source/` are checked together as a separate scope, the same way Roku loads them.

### Handling a long list of errors

A large project can report a lot of problems the first time. Fix the errors first, since they're the likeliest to be bugs. For problems you can't fix yet, such as code in a third-party library, hide them with [`diagnosticFilters`](../tooling/bsconfig.md#diagnosticfilters):

```json title="bsconfig.json"
{
    "rootDir": "src",
    "diagnosticFilters": [
        "components/vendor/**/*",
        { "src": "components/legacy/**/*", "codes": [1013] }
    ]
}
```

This hides everything in `components/vendor`, and hides warning 1013 (a file that nothing references) in `components/legacy`. To hide a single line instead, use a comment. See [Suppressing Compiler Messages](../tooling/suppressing-compiler-messages.md).

If you use VS Code, install the [BrightScript Language extension](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript). It reads the same `bsconfig.json` and shows these problems in your editor as you type.

## Step 2: Build your app with bsc

Once your project is free of errors, you can use `bsc` to build it:

```bash
npx bsc
```

This creates a zip of your app in the `out` folder, named after your project folder. You can sideload it the same way you do today, through your device's Development Application Installer, or run it with the [BrightScript Language extension](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript) for VS Code.

Add the command to your `package.json` scripts so everyone on your team builds the same way. See [Configuration](configuration.md#tips).

The built app is almost identical to your source code. The one difference is that the compiler adds BrighterScript's runtime library, `source/bslib.brs`, and a `<script>` tag for it to each component:

```xml title="components/HomeScene.xml (built)" {4}
<component name="HomeScene" extends="Scene">
    <script type="text/brightscript" uri="HomeScene.brs" />
    <script type="text/brightscript" uri="pkg:/source/utils.brs" />
    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
    ...
</component>
```

BrighterScript features like the [null-coalescing operator](../language-features/null-coalescing-operator.md) call functions in this library.

## Step 3: Convert a file to BrighterScript

To use BrighterScript features in a file, change its extension from `.brs` to `.bs`. Start with a single file, like a component's script.

Rename `HomeScene.brs` to `HomeScene.bs`, then update the `<script>` tag that references it:

```xml title="components/HomeScene.xml" {2}
<component name="HomeScene" extends="Scene">
    <script type="text/brightscript" uri="HomeScene.bs" />
    <script type="text/brightscript" uri="pkg:/source/utils.brs" />
    ...
</component>
```

When you build, the compiler transpiles `HomeScene.bs` to `HomeScene.brs` and changes the `<script>` tag to match. If you forget to update the tag, the compiler reports that the file doesn't exist:

```bsc-output
src/components/HomeScene.xml:3:43 - error BS1004: Referenced file does not exist.
```

Files in `source/` don't need any other changes, because Roku loads every file in that folder automatically.

Now you can use BrighterScript features in that file. For example, this function:

```brightscript
sub showRating(rating)
    if rating = invalid
        print "not rated"
    else
        print rating
    end if
end sub
```

can be written with the null-coalescing operator:

```brighterscript
sub showRating(rating)
    print rating ?? "not rated"
end sub
```

`.bs` and `.brs` files work together. A `.bs` file can call functions from `.brs` files, and a `.brs` file can call functions declared in `.bs` files. You can convert the rest of your project at whatever pace suits you, or leave some files as `.brs` for good.

## Step 4: Replace script tags with imports

Keeping `<script>` tags up to date is tedious, and it's easy to miss one. In `.bs` files, you can declare a file's dependencies with [`import`](../language-features/imports.md) statements instead, and the compiler adds the `<script>` tags for you.

First, turn on [`autoImportComponentScript`](../tooling/bsconfig.md#autoimportcomponentscript). With this option, each component automatically includes the `.bs` or `.brs` file with the same name, so `HomeScene.xml` includes `HomeScene.bs`:

```json title="bsconfig.json"
{
    "rootDir": "src",
    "autoImportComponentScript": true
}
```

Then move the component's other dependencies into `import` statements at the top of `HomeScene.bs`:

```brighterscript title="components/HomeScene.bs"
import "pkg:/source/utils.brs"

sub init()
    m.title = m.top.findNode("title")
    m.title.text = formatTitle("Big Buck Bunny", 2008)
end sub
```

Now you can remove the `<script>` tags from the XML file:

```xml title="components/HomeScene.xml"
<component name="HomeScene" extends="Scene">
    <children>
        <Label id="title" />
    </children>
</component>
```

When you build, the compiler adds a `<script>` tag for the component's own script, each of its imports, and the runtime library:

```xml title="components/HomeScene.xml (built)"
<component name="HomeScene" extends="Scene">
    <script type="text/brightscript" uri="pkg:/components/HomeScene.brs" />
    <script type="text/brightscript" uri="pkg:/source/utils.brs" />
    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
    <children>
        <Label id="title" />
    </children>
</component>
```

## Next steps

- Turn on [`sourceMap`](../tooling/bsconfig.md#sourcemap) so the debugger shows your `.bs` source instead of the transpiled code.
- Use [types](../language-features/types.md), [namespaces](../language-features/namespaces.md) and [classes](../language-features/classes.md) to organize larger parts of your code.
- Add [bslint](https://github.com/rokucommunity/bslint) for more checks, like unused variables and code style rules.
