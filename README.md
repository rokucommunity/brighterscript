# BrighterScript

A superset of Roku's BrightScript language. Compiles to standard BrightScript.

[![docs](https://img.shields.io/badge/docs-rokucommunity.github.io-3178c6)](https://rokucommunity.github.io/brighterscript/)
[![build status](https://img.shields.io/github/actions/workflow/status/rokucommunity/brighterscript/build.yml?branch=master&logo=github)](https://github.com/rokucommunity/brighterscript/actions?query=branch%3Amaster+workflow%3Abuild)
[![security](https://img.shields.io/github/actions/workflow/status/rokucommunity/brighterscript/security-audit.yml?branch=master&label=security&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHJlY3QgeD0iMyIgeT0iOCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjciIHJ4PSIxIiBmaWxsPSJ3aGl0ZSIvPjxwYXRoIGQ9Ik01IDhWNWEzIDMgMCAwIDEgNiAwdjMiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==)](https://github.com/rokucommunity/brighterscript/actions/workflows/security-audit.yml)
[![coverage status](https://img.shields.io/coveralls/github/rokucommunity/brighterscript?logo=coveralls)](https://coveralls.io/github/rokucommunity/brighterscript?branch=master)
[![monthly downloads](https://img.shields.io/npm/dm/brighterscript.svg?sanitize=true&logo=npm&logoColor=&label=npm)](https://npmcharts.com/compare/brighterscript?minimal=true)
[![npm version](https://img.shields.io/npm/v/brighterscript.svg?logo=npm&label=npm)](https://www.npmjs.com/package/brighterscript)
[![license](https://img.shields.io/npm/l/brighterscript.svg)](LICENSE)
[![Slack](https://img.shields.io/badge/Slack-RokuCommunity-4A154B?logo=slack)](https://join.slack.com/t/rokudevelopers/shared_invite/zt-4vw7rg6v-NH46oY7hTktpRIBM_zGvwA)

BrighterScript adds [classes, namespaces, imports, enums, interfaces, type annotations and modern operators](https://rokucommunity.github.io/brighterscript/latest/#language-features) to Roku's BrightScript language, and compiles them to plain BrightScript that runs on every Roku device. Every BrightScript file is already valid BrighterScript, so projects can adopt it one file at a time.

The compiler validates entire projects, BrightScript and BrighterScript alike, and reports errors with their exact location before anything reaches a device. It powers the [BrightScript Language](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript) extension for VS Code, and its [plugin API](https://rokucommunity.github.io/brighterscript/latest/tooling/plugins) lets teams add their own validations and code transforms.

## Documentation

The full documentation is at **[rokucommunity.github.io/brighterscript](https://rokucommunity.github.io/brighterscript/)**.

- [Introduction](https://rokucommunity.github.io/brighterscript/): what BrighterScript is, with a tour of the language.
- [Installation](https://rokucommunity.github.io/brighterscript/latest/getting-started/installation): install the compiler and run your first build.
- [bsconfig.json](https://rokucommunity.github.io/brighterscript/latest/getting-started/bsconfig): every option for configuring your project.
- [Plugins](https://rokucommunity.github.io/brighterscript/latest/tooling/plugins): extend the compiler with your own validations and code transforms.

## BrighterScript v1 is coming

> [!IMPORTANT]
> BrighterScript v1 is a complete overhaul of the compiler's core, and it's getting close to release. We'd love your help testing it before it ships.

To try it in your project:

```bash
npm install brighterscript@next
```

- Read the [v1 docs](https://rokucommunity.github.io/brighterscript/v1/) to see what's new and what's changed.
- Follow the work on the [`v1` branch](https://github.com/rokucommunity/brighterscript/tree/v1).
- Share bugs and feedback in the [v1 discussion](https://github.com/rokucommunity/brighterscript/discussions) or on [Slack](https://join.slack.com/t/rokudevelopers/shared_invite/zt-4vw7rg6v-NH46oY7hTktpRIBM_zGvwA).

## Quick start

```bash
npm install brighterscript --save-dev
npx bsc
```

From the root of a standard Roku project, that validates every file and, if there are no errors, creates `./out/project.zip`. Run `npx bsc --init` to create a `bsconfig.json`, or `npx bsc --help` for every option.

See [Installation](https://rokucommunity.github.io/brighterscript/latest/getting-started/installation) for more examples, and [bsconfig.json](https://rokucommunity.github.io/brighterscript/latest/getting-started/bsconfig) for every config option.

## Used by
<br/>
<p align="center">
    <a href="https://www.fubo.tv/">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/192530108-eb470b85-e687-4575-af69-254aab13428c.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="mailto:chris@inverted-solutions.com">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/197794500-2bac4903-ed00-463a-b243-24c68fba7962.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://www.applicaster.com/">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/192591901-20441fc8-3c6c-45ea-8851-b22430e6fb8e.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://www.redspace.com/">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/195908446-8d9652f8-9877-426f-b3c6-09119d788fd8.png">
    </a>&nbsp;&nbsp;&nbsp;
    <br/><br/>
      <a href="https://tantawowa.com/">
        <img height="38" src="https://user-images.githubusercontent.com/2544493/197795138-2ec870db-71fe-49e3-a014-692a3f31e6aa.png">
      </a>&nbsp;&nbsp;&nbsp;
     <a href="https://www.miraclechannel.ca/corcoplus">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/192593254-f2a32cd4-0482-40de-830d-c1d09690c46b.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://digitalpictureframe.tv">
      <img height="38" src="https://s3.us-east-1.wasabisys.com/tv.digitalpictureframe.assets/logo-wide.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://www.haystack.tv/">
      <img height="38" src="https://user-images.githubusercontent.com/2544493/192610056-d1b5a382-edf4-47b9-a6a5-d2d3ee9094cb.png">
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://www.tksssoftware.com/">
      <img height="38" alt="TKSS Software Inc" src="https://github.com/user-attachments/assets/332d692f-7386-495d-b29d-c2ed7d3d2e2f" />
    </a>&nbsp;&nbsp;&nbsp;
</p>
<br/>

BrighterScript also powers the [BrightScript Language](https://marketplace.visualstudio.com/items?itemName=RokuCommunity.brightscript) extension for VS Code and the [maestro framework](https://github.com/georgejecook/maestro-roku). Using BrighterScript in your project? [Open an issue](https://github.com/rokucommunity/brighterscript/issues/new) to have your logo added.

## The name

The name BrighterScript is a compliment to everything that's great about Roku's BrightScript language. Naming things is hard, and discoverability and recognizability both matter, so here's why we chose it:

- The "er" in BrighterScript represents the features added on top of BrightScript.
- It looks very similar to BrightScript, which fits, because the language is about 95% BrightScript and 5% extra (the "er" bits).
- The file extension and config file stay close to their BrightScript counterparts. `.bs` files sit right next to `.brs` files, and while `brsconfig.json` might suit a pure BrightScript project, `bsconfig.json` is close enough that you'd hardly think twice about it.

We wanted to honor BrightScript, the language BrighterScript is built on, and couldn't think of a better way than to use _most_ of its name in ours.

## Accepted security advisories

Dependencies flagged by `npm audit` that we have reviewed and chosen not to upgrade are tracked in [audit-ci.jsonc](https://github.com/RokuCommunity/brighterscript/blob/master/audit-ci.jsonc). Each entry includes the advisory ID, the date it was added, and the reason it does not apply to this project.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Acknowledgements

- **[Mark Pearce](https://github.com/markwpearce)**, for the tireless work behind the v1 rewrite. Mark is the top contributor to v1 by a wide margin, and v1 wouldn't exist without that effort.
- **[brs](https://github.com/sjbarag/brs)**, whose fast BrightScript parser is the foundation of the BrighterScript parser.
