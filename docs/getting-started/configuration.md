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
    "stagingDir": "out/staging",
    "retainStagingDir": true,
    "sourceMap": true
}
```

It keeps the staging folder around after each build, which is handy for inspecting the transpiled output, and turns on source maps so the debugger shows your original source code.

## Options you'll use most

| Option | What it does |
|---|---|
| [`rootDir`](../tooling/bsconfig.md#rootdir) | The folder your `manifest` lives in |
| [`files`](../tooling/bsconfig.md#files) | Which files are part of the project, if not everything under `rootDir` |
| [`stagingDir`](../tooling/bsconfig.md#stagingdir) | Where the transpiled files go |
| [`sourceMap`](../tooling/bsconfig.md#sourcemap) | Debug your original source code instead of the transpiled output |
| [`autoImportComponentScript`](../tooling/bsconfig.md#autoimportcomponentscript) | Automatically import the `.bs` file next to each component's `.xml` file |
| [`diagnosticFilters`](../tooling/bsconfig.md#diagnosticfilters) | Hide errors and warnings you don't care about |
| [`host`](../tooling/bsconfig.md#host) and [`password`](../tooling/bsconfig.md#password) | The Roku device to deploy to with `--deploy` |

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

- **Keep secrets out of the repo.** Pass your device's password on the command line (`bsc --deploy --host 192.168.1.10 --password secret`) instead of putting it in `bsconfig.json`.
- **Share settings between configs** with [`extends`](../tooling/bsconfig.md#extends). For example, a `bsconfig.dev.json` can extend `bsconfig.json` and only override what's different, and you build with it using `bsc --project bsconfig.dev.json`.
- **Every option also works on the command line.** Run `bsc --help` for the full list.
