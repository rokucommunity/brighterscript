# Installation

## Install the compiler

Install BrighterScript as a dev dependency of your project, so everyone on the team (and your CI) builds with the same version:

```bash
npm install brighterscript --save-dev
```

Then run the compiler with `npx bsc`. You can also install it globally to get a `bsc` command everywhere:

```bash
npm install brighterscript -g
```

## Your first build

If your project's files are laid out the way Roku expects (`manifest`, `source/`, `components/` and so on), run this from the root of your project:

```bash
npx bsc
```

That's it. The compiler finds every file in your project, checks it for syntax and validation errors, and if there are none, creates a zip of your app at `./out/project.zip`.

## Configure your project

You can configure `bsc` in two ways:

1. **A `bsconfig.json` file.** By default, `bsc` looks for a `bsconfig.json` in the directory it runs from. To create one with recommended defaults, run:

    ```bash
    npx bsc --init
    ```

    An existing `bsconfig.json` is never overwritten. To use a config file somewhere else, pass its path with `--project`. See [bsconfig.json](bsconfig.md) for every option.

2. **Command line arguments.** Every option can also be set on the command line. Run `bsc --help` for the full list.

## Examples

Your project's files are in a subfolder of your workspace:

```bash
bsc --root-dir ./rokuSourceFiles
```

Rebuild every time a file changes:

```bash
bsc --watch
```

Rebuild and redeploy to a Roku device every time a file changes:

```bash
bsc --watch --deploy --host 192.168.1.10 --password secret_password
```

Use a `bsconfig.json` that isn't in the current directory:

```bash
bsc --project ./some_folder/bsconfig.json
```

Only check for errors, like a linter (works with `--watch` too):

```bash
bsc --create-package false --copy-to-staging false
```

## Editor support

Install the [BrightScript Language extension](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript) for VS Code. It runs this compiler as you type, so you see errors immediately and get completions, hover info and go-to-definition. See [Language Server](../tooling/language-server.md) to tune it.

For a linter with more rules, see [bslint](https://github.com/rokucommunity/bslint).
