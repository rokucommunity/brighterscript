# Configuration

A `bsconfig.json` file in your project's root tells `bsc` how to build your project. Most projects only need a few options. Everything else is in the [bsconfig.json reference](../tooling/bsconfig.md).

## Create a bsconfig.json

```bash
npx bsc --init
```

This writes a `bsconfig.json` with recommended defaults, followed by every other option, commented out, with a short description of each. An existing `bsconfig.json` is never overwritten.

## A minimal config

If your project's files live in a `src` folder, this is all you need:

```jsonc title="bsconfig.json" showLineNumbers
{
    "rootDir": "src",
    "outDir": "out",
    "compilerOptions": {
        "sourceMap": true
    }
}
```

It writes the transpiled files to the `out` folder, and turns on source maps so the debugger shows your original source code.

## Options you'll use most

| Option | What it does |
|---|---|
| [`rootDir`](../tooling/bsconfig.md#rootdir) | The folder your `manifest` lives in |
| [`files`](../tooling/bsconfig.md#files) | Which files are part of the project, if not everything under `rootDir` |
| [`outDir`](../tooling/bsconfig.md#outdir) | Where the transpiled files go |
| [`compilerOptions`](../tooling/bsconfig.md#compileroptions) | Options for how your code is validated and compiled, like the two below |
| [`sourceMap`](../tooling/bsconfig.md#sourcemap) | Debug your original source code instead of the transpiled output |
| [`autoImportComponentScript`](../tooling/bsconfig.md#autoimportcomponentscript) | Automatically import the `.bs` file next to each component's `.xml` file |
| [`diagnosticFilters`](../tooling/bsconfig.md#diagnosticfilters) | Hide errors and warnings you don't care about |

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
- **Every option also works on the command line.** Run `bsc --help` for the full list.

## All options

The table above only covers the basics. There are many more options for diagnostics, source maps, plugins, type checking and more.

**[View all bsconfig.json options →](../tooling/bsconfig.md)**
