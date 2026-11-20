/**
 * Settings shared by docusaurus.config.js and scripts/site.mjs.
 *
 * Every docs version (v0, v1, ...) is its own independent Docusaurus site, built from that version's own checkout of the repo
 * and served at /brighterscript/<name>/. This repo's mainline build (the "host") builds itself, builds every other version listed
 * in doc-versions.json from its branch, and puts them all side by side. See scripts/site.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

//realpath.native gives the path's true casing. On Windows, a lowercase drive letter (`c:\` vs `C:\`, i.e. from VS Code's terminal)
//otherwise makes webpack load some modules twice and spew "multiple modules with names that only differ in casing" warnings
export const websiteDir = fs.realpathSync.native(path.dirname(fileURLToPath(import.meta.url)));
export const repoDir = path.resolve(websiteDir, '..');

/**
 * Where the whole site is hosted. If we move to a custom domain (i.e. brighterscript.rokucommunity.com),
 * change these to `https://brighterscript.rokucommunity.com` and `/`, and add a `static/CNAME` file.
 */
export const siteUrl = 'https://rokucommunity.github.io';
export const rootBaseUrl = '/brighterscript/';

/**
 * Every version on the site. The one marked `"current": true` is where the site root redirects to.
 * Only the host (mainline) build reads this. It's also written to /brighterscript/versions.json for the version dropdown.
 * @type {Array<{ name: string; label: string; branch: string; current?: boolean }>}
 */
export const versions = JSON.parse(fs.readFileSync(path.join(websiteDir, 'doc-versions.json'), 'utf8'));

/**
 * The version that this checkout of the repo *is*, based on package.json (i.e. `v0` while master is 0.x)
 */
export const localVersionName = 'v' + JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8')).version.split('.')[0];

/**
 * The version this build is for. Normally this checkout's own version, but the host overrides it when it builds an older
 * release's markdown with this checkout's tooling (see the fallback in scripts/site.mjs)
 */
export const versionName = process.env.DOCS_VERSION_NAME || localVersionName;

/**
 * This checkout's own docs/ folder
 */
export const localDocsDir = path.join(repoDir, 'docs');

/**
 * The markdown to build. Normally this checkout's docs/ folder (overridden by the same fallback)
 */
export const docsDir = process.env.DOCS_DIR || localDocsDir;

/**
 * Whether broken links fail the build. Off for the fallback, since an old release's docs can't be fixed anymore
 */
export const strictLinks = process.env.DOCS_STRICT_LINKS !== 'false';

/**
 * The base url this build is served at. scripts/site.mjs sets `DOCS_BASE_URL` from its `--base-url` flag.
 */
export const baseUrl = process.env.DOCS_BASE_URL || `${rootBaseUrl}${versionName}/`;

/**
 * The branch that "Edit this page" links point to. scripts/site.mjs sets `DOCS_EDIT_BRANCH` from its `--edit-branch` flag.
 */
export const editBranch = process.env.DOCS_EDIT_BRANCH || versions.find(x => x.name === localVersionName)?.branch || 'master';
