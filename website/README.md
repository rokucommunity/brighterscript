# BrighterScript docs website

The source for the BrighterScript docs site, built with [Docusaurus](https://docusaurus.io/). The content itself is plain markdown in the repo's [`docs/`](../docs) folder. This folder only holds the site tooling.

## Running locally
From the repo root:

```bash
npm run docs         # live-reloading dev server for this checkout's docs (i.e. http://localhost:3000/brighterscript/v0/)
npm run build-docs   # the full site with every version, into website/build
```

Both commands run `npm install` in this folder first, so there's no separate install step. To preview the full build like production, run `npm run serve` in this folder after `build-docs`.

Other versions are built from git tags, so run `git fetch --tags` first if you want them to be current.

## Writing docs
- Add or edit a `.md` file in `docs/`. Regular GitHub-flavored markdown works, and the first `# heading` becomes the page title.
- Link to other pages with relative links like `[classes](classes.md)`, same as on GitHub.
- GitHub alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) render as callout boxes on the site.
- Code blocks are highlighted at build time by [Shiki](https://shiki.style) with VS Code's Light+/Dark+ themes. BrightScript/BrighterScript blocks use the same TextMate grammar as the VS Code extension. The latest copy of [the extension's grammar](https://github.com/rokucommunity/vscode-brightscript-language/blob/master/syntaxes/brightscript.tmLanguage.json) is downloaded on every `npm run docs`/`npm run build-docs`.
- Code blocks support the same options as Docusaurus: `title="bsconfig.json"`, line ranges like `{2,4-6}`, and `showLineNumbers`. You can also highlight a single line with a `[!code highlight]` comment at the end of it. See the examples at the top of [`docs/getting-started/bsconfig.md`](../docs/getting-started/bsconfig.md).
- [`docs/sidebar.json`](../docs/sidebar.json) controls the sidebar, which is also the order of the **Previous** / **Next** buttons. Each entry's `file` is the page's path within `docs/`. `npm run docs` and `npm run build-docs` add new pages to it with a best guess for where they belong (move them if the guess is wrong), and CI fails if a page is missing from it.

## Versions
Every docs version (v0, v1, ...) is its own independent site, built by that version's own checkout of the repo with its own tooling and config. The mainline build puts them side by side.

[`doc-versions.json`](doc-versions.json) (on mainline) lists every version on the site:
- Each version lives at its own permanent URL, like `/brighterscript/v0/classes` or `/brighterscript/v1/classes`.
- The site root redirects to the version marked `"current": true`. To promote v1, move the flag. No URLs change.
- `branch` is where that version is developed. It's used for the "Edit this page" links.

What `npm run build-docs` does (see [`scripts/site.mjs`](scripts/site.mjs)):
1. Builds this checkout as the version matching its `package.json` major (v0 while master is `0.x`). It does this by running its own `npm run build-docs` with the contract flags below, exactly like every other version.
2. Clones every other version at its newest release tag (semver sorted, prereleases included, i.e. `v1` uses the newest `v1.*` tag) into the gitignored `.versions/` folder. It then builds it there with the contract below, writing straight into `build/v1/`.
3. Writes the shared files: `versions.json` (the version dropdown reads it at runtime, so old versions still list newer ones), the root redirect, and `404.html`.

If a version's tag predates the docs site (no `build-docs` script), the host builds that tag's `docs/` markdown with its own tooling instead. It skips the example transpiling, and broken links only warn, since a release can't be fixed. Once that version ships its own `build-docs`, it's used automatically. Any version that still can't be built (no tag, or no `docs/` folder) fails the build.

**The contract between the host and each version.** This is the only thing the host knows about a version, so a version is free to move or restructure its site tooling, or even switch site generators. From the version's repo root, this builds only that one version:

```bash
npm ci
npm run build-docs -- --base-url /brighterscript/v1/ --out-dir <path> [--edit-branch v1]
```

| Flag | Meaning |
|---|---|
| `--base-url` | the url the site is served at |
| `--out-dir` | where to write the built site. Relative paths resolve from where you ran the command |
| `--edit-branch` | (optional) branch for "Edit this page" links |

The host only builds the newest tag of each version. To change the contract, update and release the active branches first, or teach the host both contracts for a while.

To add a version (e.g. `v2`), add it to `doc-versions.json` on mainline. It needs at least one release tag with a `docs/` folder.

## Deploying
[`.github/workflows/docs.yml`](../.github/workflows/docs.yml) builds the site and deploys it to GitHub Pages on each push to `master` that touches `docs/` or `website/`. It also runs nightly to pick up new release tags. Pull requests only run the build, as a check.
