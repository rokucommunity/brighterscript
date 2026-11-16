/**
 * Builds and runs the docs site.
 *
 *   node scripts/site.mjs start   dev server: this checkout's docs live (at /brighterscript/<this version>/), plus every other
 *                                 version prebuilt from its newest tag (rebuilt only when there's a newer tag)
 *   node scripts/site.mjs build   the full site: every version in doc-versions.json, side by side, into website/build
 *   node scripts/site.mjs serve   serve that full build locally, like production
 *
 * How the full build works:
 *   - Every version is its own independent Docusaurus site, built by that version's own checkout of the repo.
 *   - This checkout builds itself into build/<this version>/ by running its own `npm run build-docs` with the contract args below.
 *   - Every other version is cloned at its newest release tag (semver sorted, prereleases included, i.e. `v1` -> newest `v1.*` tag)
 *     into website/.versions/<name>/, and built there the exact same way (after `npm ci`), writing straight into build/<name>/.
 *   - Then the shared files are written: build/versions.json (read by the version dropdown), build/index.html (redirects to the
 *     current version) and build/404.html.
 *   - Any version that can't be built (no tag, or its tag doesn't have the docs site yet) fails the whole build.
 *
 * The contract between the host and each version. This is ALL the host knows about a version, so a version is free to move
 * its site tooling, restructure it, or even switch site generators. From the version's repo root:
 *
 *     npm ci
 *     npm run build-docs -- --base-url /brighterscript/v1/ --out-dir <path> [--edit-branch v1]
 *
 *   builds ONLY that version:
 *     --base-url     the url the site is served at
 *     --out-dir      where to write the built site (relative paths resolve from where you ran the command)
 *     --edit-branch  (optional) the branch for "Edit this page" links
 *
 *   The host only ever builds the newest tag of each version, so changing this contract means updating and releasing the
 *   active branches first (or teaching the host both contracts for a while).
 *
 * (Internally, this script hands those settings to docusaurus.config.js via the DOCS_BASE_URL / DOCS_EDIT_BRANCH env vars.
 * That's a private detail, not part of the contract.)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import semver from 'semver';
import { versions, localVersionName, localDocsDir, rootBaseUrl, siteUrl, repoDir, websiteDir } from '../versions.mjs';
import { grammarPath } from '../code-highlighting.mjs';
import { syncSidebarFile } from '../sidebar.mjs';

const buildDir = path.join(websiteDir, 'build');
//the other versions' sites (and the shared files), prebuilt for the dev server
const devSitesDir = path.join(websiteDir, '.versions', 'sites');

function git(args, options = {}) {
    return execFileSync('git', args, { cwd: repoDir, maxBuffer: 100 * 1024 * 1024, ...options });
}

/**
 * Run a command, streaming its output, and exit if it fails
 */
function run(command, args, options) {
    const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
    if (result.status !== 0) {
        throw new Error(`Command failed (exit code ${result.status}): ${command} ${args.join(' ')}`);
    }
}

/**
 * Run npm. Prefers the same npm that's running this script (so no shell is needed, which would mangle paths with spaces)
 */
function npm(args, options) {
    if (process.env.npm_execpath?.endsWith('.js')) {
        run(process.execPath, [process.env.npm_execpath, ...args], { ...options, shell: false });
    } else {
        run('npm', args, options);
    }
}

function docusaurus(args, env = {}) {
    const bin = path.join(websiteDir, 'node_modules', '@docusaurus', 'core', 'bin', 'docusaurus.mjs');
    run(process.execPath, [bin, ...args], { cwd: websiteDir, shell: false, env: { ...process.env, ...env } });
}

/**
 * Download the latest BrightScript TextMate grammar from the vscode extension, so code blocks are highlighted exactly like VS Code does.
 * Falls back to the previously downloaded copy when offline (except in CI, where we always want the latest)
 */
async function downloadGrammar() {
    const url = 'https://raw.githubusercontent.com/rokucommunity/vscode-brightscript-language/master/syntaxes/brightscript.tmLanguage.json';
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const grammar = await response.text();
        //make sure we actually got a grammar before overwriting the last good copy
        JSON.parse(grammar);
        fs.mkdirSync(path.dirname(grammarPath), { recursive: true });
        fs.writeFileSync(grammarPath, grammar);
        console.log(`[site] downloaded brightscript grammar from ${url}`);
    } catch (e) {
        if (process.env.CI || !fs.existsSync(grammarPath)) {
            throw new Error(`Failed to download the brightscript grammar from ${url}: ${e.message}`);
        }
        console.warn(`[site] WARNING: failed to download the brightscript grammar (${e.message}). Using the previously downloaded copy.`);
    }
}

/**
 * Make sure every page in this checkout's docs/ is in docs/sidebar.json (see sidebar.mjs).
 * Locally, missing pages are added with a best guess (and deleted ones removed). In CI, it fails instead, so PRs can't forget.
 */
function syncSidebar() {
    const result = syncSidebarFile(localDocsDir, { write: !process.env.CI });
    const sidebarPath = path.relative(repoDir, result.sidebarPath);
    if (process.env.CI) {
        const problems = [
            ...result.added.map(x => `  - "${x.file}" isn't listed`),
            ...result.removed.map(x => `  - "${x}" is listed, but that page doesn't exist`)
        ];
        if (problems.length > 0) {
            throw new Error(`${sidebarPath} is out of date:\n${problems.join('\n')}\nRun \`npm run docs\` or \`npm run build-docs\` locally (they update ${sidebarPath} for you), double check where the new pages landed, and commit it.`);
        }
        return;
    }
    for (const placement of result.added) {
        console.log(`[site] added "${placement.file}" to ${sidebarPath} under "${placement.category}" (${placement.reason}). Move it if that's not the right spot.`);
    }
    for (const file of result.removed) {
        console.log(`[site] removed "${file}" from ${sidebarPath}, since that page no longer exists`);
    }
}

/**
 * Find the newest tag for a version like `v1` (i.e. the highest semver tag with major version 1)
 */
function findLatestTag(versionName) {
    const major = parseInt(versionName.replace(/^v/i, ''));
    const tags = git(['tag', '--list', `v${major}.*`], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(x => semver.valid(x) && semver.major(x) === major);
    return semver.rsort(tags)[0];
}

/**
 * Build another version from its newest release tag, using that tag's own docs tooling
 */
function buildOtherVersion(version, outDir) {
    const tag = findLatestTag(version.name);
    if (!tag) {
        throw new Error(`No git tags found for docs version "${version.name}". If you're building locally, try running: git fetch --tags`);
    }
    console.log(`\n[site] ${version.name}: building from tag ${tag}`);

    const cloneDir = path.join(websiteDir, '.versions', version.name);
    fs.rmSync(cloneDir, { recursive: true, force: true });
    git(['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', tag, pathToFileURL(repoDir).href, cloneDir], { stdio: 'inherit' });

    const scripts = JSON.parse(fs.readFileSync(path.join(cloneDir, 'package.json'), 'utf8')).scripts ?? {};
    if (!scripts['build-docs']) {
        buildVersionWithOurTooling(version, tag, cloneDir, outDir);
        return;
    }

    npm(['ci', '--no-audit', '--no-fund'], { cwd: cloneDir });
    buildVersion(version, cloneDir, outDir);
}

/**
 * Fallback for releases from before the docs site existed (no `build-docs` script): build that release's docs/ markdown
 * with THIS checkout's site tooling. Once a version ships its own `build-docs`, it's built with that instead.
 */
function buildVersionWithOurTooling(version, tag, cloneDir, outDir) {
    const docsDir = path.join(cloneDir, 'docs');
    if (!fs.existsSync(docsDir)) {
        throw new Error(`Tag ${tag} (docs version "${version.name}") has no docs/ folder to build`);
    }
    console.warn(`[site] WARNING: tag ${tag} doesn't have the docs site yet (no "build-docs" npm script), so building its docs/ folder with this checkout's tooling instead`);

    //skips transpile-doc-examples on purpose: that release's examples were already transpiled by its own compiler
    docusaurus(['build', '--out-dir', outDir], {
        DOCS_BASE_URL: `${rootBaseUrl}${version.name}/`,
        DOCS_EDIT_BRANCH: version.branch,
        DOCS_VERSION_NAME: version.name,
        DOCS_DIR: docsDir,
        //a release's docs can't be fixed anymore, so broken links there only warn
        DOCS_STRICT_LINKS: 'false'
    });
    if (!fs.existsSync(path.join(outDir, 'index.html'))) {
        throw new Error(`Building docs version "${version.name}" from tag ${tag} didn't write a site to ${outDir}`);
    }
}

/**
 * Build a single version from a checkout of the repo, using the contract at the top of this file
 */
function buildVersion(version, checkoutDir, outDir) {
    npm([
        'run', 'build-docs', '--',
        '--base-url', `${rootBaseUrl}${version.name}/`,
        '--out-dir', outDir,
        '--edit-branch', version.branch
    ], { cwd: checkoutDir });

    if (!fs.existsSync(path.join(outDir, 'index.html'))) {
        throw new Error(`Building docs version "${version.name}" from ${checkoutDir} didn't write a site to ${outDir}`);
    }
}

/**
 * Write the files shared by every version into the site root: the version list, the root redirect, and (for the full build) the 404 page
 */
function writeSharedFiles(siteRootDir, options = { include404: true }) {
    const current = versions.find(x => x.current) ?? versions[0];
    const currentUrl = `${rootBaseUrl}${current.name}/`;

    fs.mkdirSync(siteRootDir, { recursive: true });
    fs.writeFileSync(path.join(siteRootDir, 'versions.json'), JSON.stringify(
        versions.map(x => ({ name: x.name, label: x.label, current: x === current })),
        null,
        4
    ));

    //the site root redirects to the current version. Every version keeps its own permanent url, so changing `current` never moves a page
    fs.writeFileSync(path.join(siteRootDir, 'index.html'), [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '    <meta charset="utf-8">',
        '    <title>BrighterScript</title>',
        `    <meta http-equiv="refresh" content="0; url=${currentUrl}">`,
        `    <link rel="canonical" href="${siteUrl}${currentUrl}">`,
        `    <script>location.replace(${JSON.stringify(currentUrl)} + location.hash);</script>`,
        '</head>',
        `<body><a href="${currentUrl}">BrighterScript docs</a></body>`,
        '</html>',
        ''
    ].join('\n'));

    //GitHub Pages serves the root 404.html for any missing page, in any version
    if (options.include404) {
        fs.copyFileSync(path.join(siteRootDir, current.name, '404.html'), path.join(siteRootDir, '404.html'));
    }
}

/**
 * For the dev server: build every OTHER version (from its newest tag, same as the full build) into `devSitesDir`, so the
 * dev server can serve them next to this checkout's live docs. A version is only rebuilt when it has a newer tag
 * (delete website/.versions to force a rebuild). A version that can't be built only warns, so it never blocks local editing.
 */
function buildOtherVersionsForDev() {
    for (const version of versions.filter(x => x.name !== localVersionName)) {
        const outDir = path.join(devSitesDir, version.name);
        const stampPath = path.join(devSitesDir, `${version.name}.tag`);
        try {
            const tag = findLatestTag(version.name);
            if (tag && fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8') === tag && fs.existsSync(path.join(outDir, 'index.html'))) {
                console.log(`[site] ${version.name}: using the previous build of tag ${tag}`);
                continue;
            }
            fs.rmSync(outDir, { recursive: true, force: true });
            buildOtherVersion(version, outDir);
            fs.writeFileSync(stampPath, tag);
        } catch (e) {
            console.warn(`[site] WARNING: couldn't build docs version "${version.name}", so it won't be available in the dev server: ${e.message}`);
        }
    }
    writeSharedFiles(devSitesDir, { include404: false });
}

async function build(args) {
    const { values: options } = parseArgs({
        args: args,
        options: {
            'base-url': { type: 'string' },
            'out-dir': { type: 'string' },
            'edit-branch': { type: 'string' }
        }
    });

    //building a single version for a host (see the contract at the top of this file)
    if (options['base-url'] || options['out-dir']) {
        if (!options['base-url'] || !options['out-dir']) {
            throw new Error('--base-url and --out-dir must be used together');
        }
        //npm runs scripts from the package folder, so resolve relative paths against wherever the command was actually run from
        const outDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), options['out-dir']);
        syncSidebar();
        await downloadGrammar();
        docusaurus(['build', '--out-dir', outDir], {
            DOCS_BASE_URL: options['base-url'],
            ...(options['edit-branch'] ? { DOCS_EDIT_BRANCH: options['edit-branch'] } : {})
        });
        console.log(`\n[site] built ${options['base-url']} into ${outDir}`);
        return;
    }

    if (!versions.some(x => x.name === localVersionName)) {
        throw new Error(`This checkout is docs version "${localVersionName}" (from package.json), but doc-versions.json doesn't list it`);
    }

    //needed by the fallback for releases without their own docs tooling (see buildVersionWithOurTooling)
    await downloadGrammar();

    fs.rmSync(buildDir, { recursive: true, force: true });
    for (const version of versions) {
        const outDir = path.join(buildDir, version.name);
        if (version.name === localVersionName) {
            //build ourselves exactly the way we build every other version (the same contract)
            console.log(`\n[site] ${version.name}: building from this checkout`);
            buildVersion(version, repoDir, outDir);
        } else {
            buildOtherVersion(version, outDir);
        }
    }
    writeSharedFiles(buildDir);
    console.log(`\n[site] built ${versions.length} version(s) into ${buildDir}`);
}

const [command, ...rest] = process.argv.slice(2);
try {
    if (command === 'start') {
        syncSidebar();
        await downloadGrammar();
        buildOtherVersionsForDev();
        //docusaurus.config.js adds this folder to the dev server (served at /brighterscript/), next to this checkout's live docs
        docusaurus(['start', ...rest], { DOCS_DEV_SITES_DIR: devSitesDir });
    } else if (command === 'build') {
        await build(rest);
    } else if (command === 'serve') {
        //serve the full build (every version) from the site root, so the root redirect and version dropdown work like production
        docusaurus(['serve', '--dir', buildDir, ...rest], { DOCS_BASE_URL: rootBaseUrl });
    } else {
        throw new Error(`Unknown command "${command}". Expected "start", "build" or "serve"`);
    }
} catch (e) {
    console.error(`\n[site] ERROR: ${e.message}`);
    process.exit(1);
}
