# Configuration

`bsc` reads its settings from a `bsconfig.json` file in the folder you run it from. Every option has a default, so a project laid out the way Roku expects (`manifest`, `source/`, `components/` and so on) at the root of the folder builds without one. Most projects only set a few options. Everything else is in the [bsconfig.json reference](../tooling/bsconfig.md).

## Create a bsconfig.json

```bash
npx bsc --init
```

This writes a `bsconfig.json` with recommended settings, followed by every other option, commented out, with a short description of each. An existing `bsconfig.json` is never overwritten.

You can also write one by hand. The smallest useful config just tells the compiler where your app's files are:

```json title="bsconfig.json"
{
    "rootDir": "src"
}
```

## Where your files are

[`rootDir`](../tooling/bsconfig.md#rootdir) is the folder your `manifest` lives in. It defaults to the folder you run `bsc` from, so you only need it when your app is in a subfolder, like `src`.

[`files`](../tooling/bsconfig.md#files) lists which files under `rootDir` are part of the app. By default, that's everything a Roku app normally contains, so you only need it to add or leave out files.

## Where the build goes

A build copies your app's files to a staging folder, transpiles them there, and then zips that folder. The options for each step:

| Option | What it does | Default |
|---|---|---|
| [`stagingDir`](../tooling/bsconfig.md#stagingdir) | Where the transpiled files go | A temporary folder in `out` |
| [`retainStagingDir`](../tooling/bsconfig.md#retainstagingdir) | Keep the staging folder after the build | `false` |
| [`createPackage`](../tooling/bsconfig.md#createpackage) | Zip the staging folder | `true` |
| [`outFile`](../tooling/bsconfig.md#outfile) | Where the zip goes | `out/<your project's folder name>.zip` |

With the defaults, you get a zip in the `out` folder, ready to sideload through your device's Development Application Installer.

`bsc --init` changes these. It sets `stagingDir` to `dist`, keeps that folder, and doesn't create a zip. That suits tools that sideload a folder for you, like the VS Code extension and roku-deploy, and makes it easy to look at the transpiled code.

## BrighterScript options

| Option | What it does |
|---|---|
| [`sourceMap`](../tooling/bsconfig.md#sourcemap) | Writes source maps, so the debugger shows your original source code instead of the transpiled code |
| [`autoImportComponentScript`](../tooling/bsconfig.md#autoimportcomponentscript) | Each component's XML file automatically includes the `.bs` or `.brs` file with the same name, so you don't need a `<script>` tag for it |
| [`diagnosticFilters`](../tooling/bsconfig.md#diagnosticfilters) | Hides errors and warnings you don't want to see, such as the ones in third-party code |

`bsc --init` turns on `sourceMap` and `autoImportComponentScript`.

## Tips

- **Add `bsc` to your `package.json` scripts,** so everyone runs the same command:

    ```json title="package.json"
    {
        "scripts": {
            "build": "bsc",
            "watch": "bsc --watch"
        }
    }
    ```

- **Share settings between configs** with [`extends`](../tooling/bsconfig.md#extends). For example, a `bsconfig.dev.json` can extend `bsconfig.json` and only override what's different, and you build with it using `bsc --project bsconfig.dev.json`.
- **Every option also works on the command line.** For example, `bsc --root-dir src`. Run `bsc --help` for the full list.

## All options

There are many more options for diagnostics, source maps, plugins and more.

**[View all bsconfig.json options →](../tooling/bsconfig.md)**
