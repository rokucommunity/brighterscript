/**
 * Builds and runs the docs site.
 *
 *   node scripts/site.mjs start   dev server: this checkout's docs live (at /brighterscript/<this version>/), plus every other
 *                                 version built from its branch in the background (rebuilt on every start), and a
 *                                 search index that's rebuilt in the background as you edit
 *   node scripts/site.mjs build   the full site: every version in doc-versions.json, side by side, into website/build
 *   node scripts/site.mjs serve   serve that full build locally, like production
 *
 * How the full build works:
 *   - Every version is its own independent Docusaurus site, built by that version's own checkout of the repo.
 *   - This checkout builds itself into build/<this version>/ by running its own `npm run build-docs` with the contract args below.
 *   - Every other version is cloned at the newest commit of its branch (`branch` in doc-versions.json, i.e. `origin/v1`)
 *     into website/.versions/<name>/, and built there the exact same way (after `npm ci`), writing straight into build/<name>/.
 *   - Then the shared files are written: build/versions.json (read by the version dropdown), build/index.html (redirects to the
 *     current version) and build/404.html.
 *   - Any version that can't be built (no branch, or no docs/ folder) fails the whole build.
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
 *   The host builds each version from its branch, so changing this contract means updating the active branches first
 *   (or teaching the host both contracts for a while).
 *
 * (Internally, this script hands those settings to docusaurus.config.js via the DOCS_BASE_URL / DOCS_EDIT_BRANCH env vars.
 * That's a private detail, not part of the contract.)
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import zlib from 'node:zlib';
import { versions, localVersionName, localDocsDir, rootBaseUrl, siteUrl, repoDir, websiteDir } from '../versions.mjs';
import { grammarPath, fallbackGrammarPath } from '../code-highlighting.mjs';
import { syncSidebarFile, otherCategoryLabel } from '../sidebar.mjs';

const buildDir = path.join(websiteDir, 'build');
//`npm run docs`: the other versions' sites (and the shared files), served at /brighterscript/
const devSitesDir = path.join(websiteDir, '.versions', 'sites');
//`npm run docs`: files for THIS version that change while the dev server runs (pages.json, search-index.json), served at
///brighterscript/<this version>/. The dev server reloads the page when they change
const devLiveDir = path.join(websiteDir, '.versions', 'live');

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

const docusaurusBin = path.join(websiteDir, 'node_modules', '@docusaurus', 'core', 'bin', 'docusaurus.mjs');

function docusaurus(args, env = {}) {
    run(process.execPath, [docusaurusBin, ...args], { cwd: websiteDir, shell: false, env: { ...process.env, ...env } });
}

/**
 * Like `docusaurus()`, but without blocking (so other work, like the background search index build, can finish meanwhile)
 */
function docusaurusAsync(args, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [docusaurusBin, ...args], { cwd: websiteDir, stdio: 'inherit', env: { ...process.env, ...env } });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`docusaurus ${args[0]} exited with code ${code}`))));
    });
}

/**
 * Make a separate docusaurus site folder that uses THIS site's config, src/, static/ and node_modules/ (via links).
 * Building from it (`docusaurusBuildArgs`) gives that build its own .docusaurus/ folder, so it can run while the dev
 * server (or another build) is running without tripping over each other's generated files.
 */
function createLinkedSiteDir(siteDir) {
    const linkNames = ['src', 'static', 'node_modules'];
    //remove the links themselves first, so deleting the folder can never reach through them into the real folders
    for (const name of linkNames) {
        const linkPath = path.join(siteDir, name);
        if (fs.lstatSync(linkPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
            //(junctions on windows are removed like folders, symlinks everywhere else like files)
            if (process.platform === 'win32') {
                fs.rmdirSync(linkPath);
            } else {
                fs.unlinkSync(linkPath);
            }
        }
    }
    fs.rmSync(siteDir, { recursive: true, force: true });
    fs.mkdirSync(siteDir, { recursive: true });
    for (const name of linkNames) {
        //(junctions, since they don't need admin rights on windows)
        fs.symlinkSync(path.join(websiteDir, name), path.join(siteDir, name), 'junction');
    }
    fs.copyFileSync(path.join(websiteDir, 'package.json'), path.join(siteDir, 'package.json'));
    return siteDir;
}

/**
 * The `docusaurus build` args to build a linked site folder (see createLinkedSiteDir) into outDir
 */
function docusaurusBuildArgs(siteDir, outDir) {
    return ['build', siteDir, '--config', path.join(websiteDir, 'docusaurus.config.js'), '--out-dir', outDir];
}

/**
 * The search index is built from the rendered pages, which the dev server never writes. So for `npm run docs`, build this
 * checkout's site in the background and hand its search index to the dev server (which reloads the page when it lands).
 * It rebuilds a few seconds after you stop editing docs/, so search keeps up with your edits.
 */
function keepSearchIndexUpToDate() {
    const siteDir = createLinkedSiteDir(path.join(websiteDir, '.versions', 'search-site'));
    const outDir = path.join(siteDir, 'build');
    const logPath = path.join(siteDir, 'build.log');

    let running;
    let rerunWhenDone = false;
    const build = () => {
        if (running) {
            //one at a time: build again once this one finishes, so the index ends up with the newest edits
            rerunWhenDone = true;
            return;
        }
        const startedAt = Date.now();
        const log = fs.openSync(logPath, 'w');
        running = spawn(process.execPath, [docusaurusBin, ...docusaurusBuildArgs(siteDir, outDir)], {
            cwd: websiteDir,
            stdio: ['ignore', log, log],
            //(a broken link you're in the middle of fixing shouldn't block search)
            env: { ...process.env, DOCS_STRICT_LINKS: 'false' }
        });
        running.on('exit', (code) => {
            fs.closeSync(log);
            running = undefined;
            const indexPath = path.join(outDir, 'search-index.json');
            if (code !== 0 || !fs.existsSync(indexPath)) {
                console.warn(`[site] WARNING: couldn't build the search index, so search won't be up to date in the dev server. See ${logPath}`);
            } else {
                fs.mkdirSync(devLiveDir, { recursive: true });
                fs.copyFileSync(indexPath, path.join(devLiveDir, 'search-index.json'));
                console.log(`[site] search index updated (${Math.round((Date.now() - startedAt) / 1000)}s, ${describeFileSize(indexPath)})`);
            }
            if (rerunWhenDone) {
                rerunWhenDone = false;
                build();
            }
        });
    };

    console.log('[site] building the search index in the background (the page reloads when it\'s ready)...');
    build();

    let timer;
    fs.watch(localDocsDir, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(build, 3000);
    });
}

/**
 * Download the latest BrightScript TextMate grammar from the vscode extension, so code blocks are highlighted exactly like VS Code does.
 * Falls back to the copy committed in website/grammars/ if the download fails
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
        console.warn(`[site] WARNING: failed to download the brightscript grammar (${e.message}). Using the committed copy in ${path.relative(repoDir, fallbackGrammarPath)}`);
        fs.mkdirSync(path.dirname(grammarPath), { recursive: true });
        fs.copyFileSync(fallbackGrammarPath, grammarPath);
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
            ...result.removed.map(x => `  - "${x}" is listed, but that page doesn't exist`),
            //(pages that were just added to "Other" are already reported as not listed)
            ...result.other.filter(x => !result.added.some(y => y.file === x)).map(x => `  - "${x}" is in the "${otherCategoryLabel}" category. Move it to a real one`)
        ];
        if (problems.length > 0) {
            throw new Error(`${sidebarPath} is out of date:\n${problems.join('\n')}\nRun \`npm run docs\` or \`npm run build-docs\` locally (they update ${sidebarPath} for you), move any new pages to the right category, and commit it.`);
        }
        return;
    }
    for (const placement of result.added) {
        console.log(`[site] added "${placement.file}" to ${sidebarPath} under "${placement.category}" (${placement.reason}). Move it if that's not the right spot.`);
    }
    for (const file of result.other) {
        console.warn(`[site] WARNING: "${file}" is in the "${otherCategoryLabel}" category of ${sidebarPath}. Move it to a real category before you open a PR (CI fails until you do).`);
    }
    for (const file of result.removed) {
        console.log(`[site] removed "${file}" from ${sidebarPath}, since that page no longer exists`);
    }
}

/**
 * The newest commit of a version's branch: the remote's copy (i.e. `origin/v1`) if there is one, otherwise the local branch
 */
function findBranchCommit(version) {
    for (const ref of [`refs/remotes/origin/${version.branch}`, `refs/heads/${version.branch}`]) {
        const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoDir, encoding: 'utf8' });
        if (result.status === 0) {
            return { ref: ref, name: ref.replace(/^refs\/(remotes|heads)\//, ''), commit: result.stdout.trim() };
        }
    }
}

/**
 * Build another version from the newest commit of its branch, using that commit's own docs tooling
 */
function buildOtherVersion(version, outDir) {
    const branch = findBranchCommit(version);
    if (!branch) {
        throw new Error(`Couldn't find branch "${version.branch}" for docs version "${version.name}". If you're building locally, try running: git fetch origin ${version.branch}`);
    }
    const source = `${branch.name} (${branch.commit.substring(0, 8)})`;
    console.log(`\n[site] ${version.name}: building from ${source}`);

    const cloneDir = path.join(websiteDir, '.versions', version.name);
    fs.rmSync(cloneDir, { recursive: true, force: true });
    //fetch that exact ref from this repo (a plain clone only brings along local branches and tags, not `origin/*`)
    git(['init', '--quiet', cloneDir], { stdio: 'inherit' });
    git(['fetch', '--quiet', '--depth', '1', pathToFileURL(repoDir).href, branch.ref], { cwd: cloneDir, stdio: 'inherit' });
    git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: cloneDir, stdio: 'inherit' });

    const scripts = JSON.parse(fs.readFileSync(path.join(cloneDir, 'package.json'), 'utf8')).scripts ?? {};
    if (!scripts['build-docs']) {
        buildVersionWithOurTooling(version, source, cloneDir, outDir);
        return;
    }

    npm(['ci', '--no-audit', '--no-fund'], { cwd: cloneDir });
    buildVersion(version, cloneDir, outDir);
}

/**
 * Fallback for branches that don't have the docs site yet (no `build-docs` script): build that branch's docs/ markdown
 * with THIS checkout's site tooling. Once a version's branch has its own `build-docs`, it's built with that instead.
 */
function buildVersionWithOurTooling(version, source, cloneDir, outDir) {
    const docsDir = path.join(cloneDir, 'docs');
    if (!fs.existsSync(docsDir)) {
        throw new Error(`${source} (docs version "${version.name}") has no docs/ folder to build`);
    }
    console.warn(`[site] WARNING: ${source} doesn't have the docs site yet (no "build-docs" npm script), so building its docs/ folder with this checkout's tooling instead`);

    //skips transpile-doc-examples on purpose: that branch's examples are transpiled by its own compiler.
    //Builds from a linked site folder, so it doesn't share .docusaurus/ with a running dev server (or the host's own build)
    const siteDir = createLinkedSiteDir(path.join(websiteDir, '.versions', `${version.name}-site`));
    docusaurus(docusaurusBuildArgs(siteDir, outDir), {
        DOCS_BASE_URL: `${rootBaseUrl}${version.name}/`,
        DOCS_EDIT_BRANCH: version.branch,
        DOCS_VERSION_NAME: version.name,
        DOCS_DIR: docsDir,
        //that branch's links are checked by its own docs build once it has one, so broken links only warn here
        DOCS_STRICT_LINKS: 'false'
    });
    if (!fs.existsSync(path.join(outDir, 'index.html'))) {
        throw new Error(`Building docs version "${version.name}" from ${source} didn't write a site to ${outDir}`);
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
    writeRedirect(path.join(siteRootDir, 'index.html'), currentUrl);

    //GitHub Pages serves the root 404.html for any missing page, in any version
    if (options.include404) {
        fs.copyFileSync(path.join(siteRootDir, current.name, '404.html'), path.join(siteRootDir, '404.html'));
    }

    //one sitemap that lists every version's own sitemap.xml, to submit to search engines (i.e. Google Search Console).
    //(a robots.txt can't point at it: crawlers only read robots.txt at the domain root, which this site doesn't own)
    const sitemaps = versions
        .filter(x => fs.existsSync(path.join(siteRootDir, x.name, 'sitemap.xml')))
        .map(x => `    <sitemap><loc>${siteUrl}${rootBaseUrl}${x.name}/sitemap.xml</loc></sitemap>`);
    if (sitemaps.length > 0) {
        fs.writeFileSync(path.join(siteRootDir, 'sitemap.xml'), [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            ...sitemaps,
            '</sitemapindex>',
            ''
        ].join('\n'));
    }

    //`/latest/<page>` redirects to that page in the current version, for links that should always show the newest docs
    //(i.e. the README). Search engines are pointed at the versioned page (canonical), so `latest` never shows up in results.
    //Missing `latest` pages are handled by the 404 page (src/theme/NotFound/Content)
    const pagesPath = path.join(siteRootDir, current.name, 'pages.json');
    if (fs.existsSync(pagesPath)) {
        for (const page of JSON.parse(fs.readFileSync(pagesPath, 'utf8'))) {
            //(built like the docs themselves: `classes.html` is served at `classes`, since trailingSlash is false)
            const file = page.path ? `${page.path}.html` : 'index.html';
            writeRedirect(path.join(siteRootDir, 'latest', file), `${currentUrl}${page.path}`, page.title);
        }
    }
}

/**
 * A page that immediately redirects to `url` (keeping the #hash), and tells search engines `url` is the real page
 */
function writeRedirect(filePath, url, title = 'BrighterScript') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '    <meta charset="utf-8">',
        `    <title>${escapeHtml(title)}</title>`,
        `    <meta http-equiv="refresh" content="0; url=${escapeHtml(url)}">`,
        `    <link rel="canonical" href="${escapeHtml(siteUrl + url)}">`,
        `    <script>location.replace(${JSON.stringify(url)} + location.hash);</script>`,
        '</head>',
        `<body><a href="${escapeHtml(url)}">${escapeHtml(title)}</a></body>`,
        '</html>',
        ''
    ].join('\n'));
}

/**
 * A file's size, and its gzipped size (what browsers actually download from GitHub Pages), i.e. `660 KB, 140 KB gzipped`
 */
function describeFileSize(filePath) {
    const contents = fs.readFileSync(filePath);
    const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
    return `${kb(contents.length)}, ${kb(zlib.gzipSync(contents).length)} gzipped`;
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The page a version shows in the dev server while it's still building. It checks every couple of seconds, and opens the
 * page you asked for once the version is ready
 */
function writeBuildingPlaceholder(version, dir) {
    fs.mkdirSync(dir, { recursive: true });
    const versionUrl = `${rootBaseUrl}${version.name}/`;
    fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${version.label} docs are still building</title>
    <style>
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: 'Segoe UI', -apple-system, sans-serif; background: #fdfdfd; color: #292929; }
        @media (prefers-color-scheme: dark) { body { background: #161e27; color: #e6e8eb; } }
        main { max-width: 32rem; padding: 1rem; text-align: center; }
        .spinner { width: 2rem; height: 2rem; margin: 0 auto 1rem; border: 3px solid #3178c655; border-top-color: #3178c6; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        a { color: #3178c6; }
    </style>
</head>
<body>
    <main>
        <div class="spinner"></div>
        <h1>The ${version.label} docs are still building</h1>
        <p>This only happens in the local dev server. This page opens by itself as soon as they're ready.</p>
        <p><a href="${rootBaseUrl}${localVersionName}/">Back to the ${localVersionName} docs</a></p>
    </main>
    <script>
        //the page that was asked for (missing pages are sent here as ?missing=<path>)
        var missing = new URLSearchParams(location.search).get('missing');
        var target = ${JSON.stringify(versionUrl)} + (missing || '') + location.hash;
        setInterval(function () {
            fetch(${JSON.stringify(`${versionUrl}pages.json`)}, { cache: 'no-store' }).then(function (response) {
                if (response.ok) {
                    location.replace(target);
                }
            }).catch(function () { });
        }, 2000);
    </script>
</body>
</html>
`);
}

/**
 * For the dev server: build every OTHER version (from its branch, same as the full build) in the background, one at a
 * time, so the dev server starts right away. Until a version is ready, it shows a "still building" page that opens the
 * real page when it's done. Rebuilt on every start, so they're never stale. A version that can't be built only warns.
 */
function buildOtherVersionsForDevInBackground() {
    const others = versions.filter(x => x.name !== localVersionName);
    for (const version of others) {
        writeBuildingPlaceholder(version, path.join(devSitesDir, version.name));
    }
    const buildNext = (index) => {
        const version = others[index];
        if (!version) {
            return;
        }
        const startedAt = Date.now();
        //built somewhere else first, then swapped in, so the placeholder stays up until the whole site is there
        const stagingDir = path.join(websiteDir, '.versions', 'staging', version.name);
        const logPath = path.join(websiteDir, '.versions', `${version.name}-build.log`);
        fs.rmSync(stagingDir, { recursive: true, force: true });
        console.log(`[site] building docs version "${version.name}" in the background...`);
        const log = fs.openSync(logPath, 'w');
        const child = spawn(process.execPath, [process.argv[1], 'build-version', version.name, stagingDir], {
            cwd: websiteDir,
            stdio: ['ignore', log, log]
        });
        child.on('exit', (code) => {
            fs.closeSync(log);
            if (code === 0 && fs.existsSync(path.join(stagingDir, 'index.html'))) {
                const dir = path.join(devSitesDir, version.name);
                fs.rmSync(dir, { recursive: true, force: true });
                fs.renameSync(stagingDir, dir);
                const indexPath = path.join(dir, 'search-index.json');
                const indexSize = fs.existsSync(indexPath) ? `, search index ${describeFileSize(indexPath)}` : '';
                console.log(`[site] docs version "${version.name}" is ready (${Math.round((Date.now() - startedAt) / 1000)}s${indexSize})`);
            } else {
                console.warn(`[site] WARNING: couldn't build docs version "${version.name}", so it won't be available in the dev server. See ${logPath}`);
                fs.writeFileSync(path.join(devSitesDir, version.name, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Couldn't build the ${version.label} docs</title></head><body style="font-family: sans-serif; padding: 2rem"><h1>Couldn't build the ${version.label} docs</h1><p>See <code>${logPath}</code> for details. <a href="${rootBaseUrl}${localVersionName}/">Back to the ${localVersionName} docs</a></p></body></html>`);
            }
            buildNext(index + 1);
        });
    };
    buildNext(0);
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
        fs.rmSync(devSitesDir, { recursive: true, force: true });
        fs.rmSync(devLiveDir, { recursive: true, force: true });
        fs.mkdirSync(devLiveDir, { recursive: true });
        //an empty search index until the real one is built, so search finds nothing instead of loading the dev server's html page as json
        fs.writeFileSync(path.join(devLiveDir, 'search-index.json'), '[]');
        writeSharedFiles(devSitesDir, { include404: false });
        buildOtherVersionsForDevInBackground();
        keepSearchIndexUpToDate();
        //docusaurus.config.js adds these folders to the dev server, next to this checkout's live docs
        await docusaurusAsync(['start', ...rest], { DOCS_DEV_SITES_DIR: devSitesDir, DOCS_DEV_LIVE_DIR: devLiveDir });
    } else if (command === 'build') {
        await build(rest);
    } else if (command === 'build-version') {
        //(internal, for the dev server's background builds) build one other version from its branch into a folder
        const [name, outDir] = rest;
        buildOtherVersion(versions.find(x => x.name === name), outDir);
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
