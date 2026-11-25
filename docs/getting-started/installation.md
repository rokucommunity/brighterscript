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

That's it. The compiler finds every file in your project, checks it for syntax and validation errors, and if there are none, creates a zip of your app in the `out` folder, named after your project's folder.

To configure your build, see [Configuration](configuration.md).

## Examples

Your project's files are in a subfolder of your workspace:

```bash
bsc --root-dir ./rokuSourceFiles
```

Rebuild every time a file changes:

```bash
bsc --watch
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
