# BrighterScript docs website

The source for the BrighterScript docs site, built with [Docusaurus](https://docusaurus.io/). The content itself is plain markdown in the repo's [`docs/`](../docs) folder. This folder only holds the site tooling.

## Running locally
From the repo root:

```bash
npm run docs         # dev server: this checkout's docs live-reload (i.e. http://localhost:3000/brighterscript/v0/), and every other version builds in the background
npm run build-docs   # the full site with every version, into website/build
```

Both commands run `npm install` in this folder first, so there's no separate install step. To preview the full build like production, run `npm run serve` in this folder after `build-docs`.

Search ([docusaurus-search-local](https://github.com/easyops-cn/docusaurus-search-local)) is indexed from the built pages. `npm run docs` builds that index in the background (about 30 seconds), at startup and again a few seconds after you stop editing `docs/`, and reloads the page each time it's ready. Each version searches its own pages.

Other versions are built from their branches (`origin/v1`, ...), so run `git fetch` first if you want them to be current.

## Writing docs
- Add or edit a `.md` file in `docs/`. Regular GitHub-flavored markdown works, and the first `# heading` becomes the page title.
- Link to other pages with relative links like `[classes](classes.md)`, same as on GitHub.
- GitHub alerts (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) render as callout boxes on the site.
- Code blocks are highlighted at build time by [Shiki](https://shiki.style) with VS Code's Light+/Dark+ themes. BrightScript/BrighterScript blocks use the same TextMate grammar as the VS Code extension. The latest copy of [the extension's grammar](https://github.com/rokucommunity/vscode-brightscript-language/blob/master/syntaxes/brightscript.tmLanguage.json) is downloaded on every `npm run docs`/`npm run build-docs`, with a committed copy in [`grammars/`](grammars) as the fallback if that fails.
- Code blocks support the same options as Docusaurus: `title="bsconfig.json"`, line ranges like `{2,4-6}`, and `showLineNumbers`. You can also highlight a single line with a `[!code highlight]` comment at the end of it. See the examples in [`docs/getting-started/configuration.md`](../docs/getting-started/configuration.md).
- [`docs/sidebar.json`](../docs/sidebar.json) controls the sidebar, which is also the order of the **Previous** / **Next** buttons. Its entries are pages (like the introduction, at the top) or categories of pages, and each page's `file` is its path within `docs/`. A page shows its own `# heading` in the sidebar unless you give it a `label`. The home page is `docs/readme.md` (docusaurus serves it at the version's root url). `npm run docs` and `npm run build-docs` add new pages to it with a best guess for where they belong (move them if the guess is wrong). A page with nothing in common with the others goes under "Uncategorized". CI fails if a page is missing from it, or if anything is still under "Uncategorized".

## Versions
Every docs version (v0, v1, ...) is its own independent site, built by that version's own checkout of the repo with its own tooling and config. The mainline build puts them side by side.

[`doc-versions.json`](doc-versions.json) (on mainline) lists every version on the site:
- Each version lives at its own permanent URL, like `/brighterscript/v0/classes` or `/brighterscript/v1/classes`.
- The site root redirects to the version marked `"current": true`. To promote v1, move the flag. No URLs change.
- `/brighterscript/latest/<page>` redirects to that page in the current version, for links that should always show the newest docs (like the repo README). Search engines only see the versioned URLs.
- `branch` is where that version is developed. The site builds that version from it, and the "Edit this page" links point to it.

What `npm run build-docs` does (see [`scripts/site.mjs`](scripts/site.mjs)):
1. Builds this checkout as the version matching its `package.json` major (v0 while master is `0.x`). It does this by running its own `npm run build-docs` with the contract flags below, exactly like every other version.
2. Clones every other version at the newest commit of its branch (i.e. `origin/v1`) into the gitignored `.versions/` folder. It then builds it there with the contract below, writing straight into `build/v1/`.
3. Writes the shared files: `versions.json` (the version dropdown reads it at runtime, so old versions still list newer ones), the root redirect, and `404.html`.

The version dropdown keeps you on the same page when you switch versions. If that page doesn't exist in the other version, you land on that version's "not in this version" page, with its sidebar. If the page only moved to another folder, you go straight to it instead. The page also links to the same page in any other version that has it, using each version's `pages.json`, and suggests similar pages. A dead link sends you to the same page.

If a version's branch doesn't have the docs site yet (no `build-docs` script), the host builds that branch's `docs/` markdown with its own tooling instead. It skips the example transpiling, and broken links only warn. Once that branch has its own `build-docs`, it's used automatically. Any version that still can't be built (no branch, or no `docs/` folder) fails the build.

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

The host builds each version from its branch. To change the contract, update the active branches first, or teach the host both contracts for a while.

To add a version (e.g. `v2`), add it to `doc-versions.json` on mainline. Its branch needs a `docs/` folder.

## Deploying
[`.github/workflows/docs.yml`](../.github/workflows/docs.yml) builds every version and deploys the site to GitHub Pages on every push to `master` or to any version's branch (`v1`, ...). It always runs from `master`: a push to another version's branch just starts the workflow on `master`. Pull requests are checked by the docs build in the main CI job.
