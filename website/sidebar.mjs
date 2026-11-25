/**
 * The docs sidebar, driven by `docs/sidebar.json`.
 *
 * The sidebar order is also the order of the "Previous" / "Next" buttons, so it should read like a book.
 * docs/sidebar.json lives next to the markdown (not in the website tooling), so every version branch owns its own order.
 * Its top-level `items` are pages (like the introduction) or categories of pages. A page's `file` is the markdown file's
 * path within docs/ (i.e. `language-features/classes.md`).
 *
 * Keeping it up to date is (mostly) automatic:
 *   - `npm run docs` / `npm run build-docs` add any page that's missing from sidebar.json, using a best guess for where it
 *     belongs, and remove entries for pages that no longer exist. You'll see the edit in your diff; move it if the guess is wrong.
 *     A page with nothing in common with the others goes in an "Uncategorized" category at the end, to be moved somewhere real.
 *   - In CI, the build fails instead if sidebar.json is out of date (or has anything in "Uncategorized"), so every page gets a real spot.
 *   - Releases from before sidebar.json existed get the same best guess, in memory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sidebarFileName = 'sidebar.json';

/**
 * Where a page goes when nothing hints at where it belongs. It's a holding spot: CI fails while this checkout's
 * sidebar.json has anything in it, so someone picks a real category
 */
export const otherCategoryLabel = 'Uncategorized';

/**
 * @typedef {{ file: string; label?: string }} SidebarEntry
 * @typedef {{ label: string; items: SidebarEntry[] }} SidebarCategory
 * @typedef {SidebarEntry | SidebarCategory} SidebarItem a top-level item: a page, or a category of pages
 * @typedef {{ file: string; title: string }} DocInfo
 */

/** @returns {item is SidebarCategory} */
function isCategory(item) {
    return Array.isArray(item.items);
}

/**
 * Every page in the sidebar, in order (top-level pages and the pages in each category)
 * @param {SidebarItem[]} items
 * @returns {SidebarEntry[]}
 */
function entriesOf(items) {
    return items.flatMap(x => (isCategory(x) ? x.items : [x]));
}

/**
 * Find every doc in a docs folder: its file (path within the folder, with forward slashes) and its title (first `# heading`)
 * @returns {DocInfo[]}
 */
export function findDocs(docsDir, prefix = '') {
    const docs = [];
    for (const entry of fs.readdirSync(path.join(docsDir, prefix), { withFileTypes: true })) {
        const relativePath = prefix + entry.name;
        if (entry.isDirectory()) {
            docs.push(...findDocs(docsDir, relativePath + '/'));
        } else if (/\.mdx?$/i.test(entry.name) && !entry.name.startsWith('_')) {
            const contents = fs.readFileSync(path.join(docsDir, relativePath), 'utf8');
            docs.push({
                file: relativePath,
                title: /^#\s+(.+)$/m.exec(contents)?.[1].trim() ?? ''
            });
        }
    }
    return docs;
}

/**
 * The docusaurus doc id for a file (`language-features/classes.md` -> `language-features/classes`)
 */
function idOf(file) {
    return file.replace(/\.mdx?$/i, '');
}

function folderOf(file) {
    return file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : '';
}

function baseNameOf(file) {
    return file.split('/').pop().toLowerCase();
}

function wordsOf(doc) {
    return new Set(
        `${idOf(doc.file)} ${doc.title}`.toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 2)
    );
}

/**
 * Put every doc that isn't in the sidebar yet where it most likely belongs (always in a category). Returns where each one went.
 * @param {SidebarItem[]} items the sidebar's top-level items (modified in place)
 * @param {DocInfo[]} allDocs
 */
export function placeMissingDocs(items, allDocs) {
    const listed = new Set(entriesOf(items).map(x => x.file));
    const categories = items.filter(isCategory);
    const missing = allDocs.filter(x => !listed.has(x.file)).sort((a, b) => a.file.localeCompare(b.file));
    const placements = [];
    if (missing.length === 0) {
        return placements;
    }

    //words that show up in lots of docs (like "brighterscript") say nothing about where a doc belongs
    const docCountByWord = new Map();
    for (const doc of allDocs) {
        for (const word of wordsOf(doc)) {
            docCountByWord.set(word, (docCountByWord.get(word) ?? 0) + 1);
        }
    }
    const isMeaningful = (word) => docCountByWord.get(word) <= Math.max(1, allDocs.length / 4);
    const docsByFile = new Map(allDocs.map(x => [x.file, x]));

    for (const doc of missing) {
        const words = [...wordsOf(doc)].filter(isMeaningful);
        let best;
        for (const category of categories) {
            for (const [index, item] of category.items.entries()) {
                const other = docsByFile.get(item.file);
                if (!other) {
                    continue;
                }
                //a doc in the same folder is the strongest hint, then shared words in the name/title
                const sameFolder = folderOf(doc.file) !== '' && folderOf(doc.file) === folderOf(other.file) ? 100 : 0;
                const otherWords = wordsOf(other);
                const score = sameFolder + words.filter(x => otherWords.has(x)).length;
                if (score > 0 && (!best || score > best.score)) {
                    best = { category: category, index: index, score: score, reason: sameFolder ? `same folder as "${item.file}"` : `similar to "${item.file}"` };
                }
            }
        }
        //no hints at all: the "Uncategorized" category at the end of the sidebar
        if (!best) {
            let other = categories.find(x => x.label === otherCategoryLabel);
            if (!other) {
                other = { label: otherCategoryLabel, items: [] };
                categories.push(other);
                items.push(other);
            }
            best = { category: other, index: other.items.length - 1, reason: 'no similar pages' };
        }
        //(no label: the sidebar shows the page's own `# heading`, unless someone adds a label to override it)
        best.category.items.splice(best.index + 1, 0, { file: doc.file });
        placements.push({ file: doc.file, category: best.category.label, reason: best.reason });
    }
    return placements;
}

function readSidebarFile(sidebarPath) {
    return fs.existsSync(sidebarPath) ? JSON.parse(fs.readFileSync(sidebarPath, 'utf8')) : { items: [] };
}

/**
 * Bring a docs folder's sidebar.json up to date with the docs that actually exist
 * @param {string} docsDir
 * @param {{ write: boolean }} options when false, only report what's out of date
 */
export function syncSidebarFile(docsDir, options) {
    const sidebarPath = path.join(docsDir, sidebarFileName);
    const sidebar = readSidebarFile(sidebarPath);
    const docs = findDocs(docsDir);
    const existingFiles = new Set(docs.map(x => x.file));

    const removed = [];
    const exists = (entry) => {
        if (!existingFiles.has(entry.file)) {
            removed.push(entry.file);
            return false;
        }
        return true;
    };
    for (const category of sidebar.items.filter(isCategory)) {
        category.items = category.items.filter(exists);
    }
    sidebar.items = sidebar.items.filter(x => (isCategory(x) ? x.items.length > 0 : exists(x)));
    const added = placeMissingDocs(sidebar.items, docs);

    if (options.write) {
        const text = (JSON.stringify(sidebar, null, 4) + '\n')
            //keep each entry on one line, i.e. `{ "file": "language-features/classes.md", "label": "Classes" }`
            .replace(/\{\s*("file": "(?:[^"\\]|\\.)*")(?:,\s*("label": "(?:[^"\\]|\\.)*"))?\s*\}/g, (match, file, label) => `{ ${file}${label ? `, ${label}` : ''} }`)
            //the platform's line endings, to match the repo's line-ending lint
            .replace(/\r?\n/g, os.EOL);
        if (!fs.existsSync(sidebarPath) || fs.readFileSync(sidebarPath, 'utf8') !== text) {
            fs.writeFileSync(sidebarPath, text);
        }
    }
    const other = sidebar.items.find(x => isCategory(x) && x.label === otherCategoryLabel)?.items.map(x => x.file) ?? [];
    return { sidebarPath: sidebarPath, added: added, removed: removed, other: other };
}

/**
 * The docusaurus `sidebarItemsGenerator` for a version, built from that version's sidebar.json
 * (or `fallbackSidebarPath`, for releases from before sidebar.json existed)
 */
export function createSidebarItemsGenerator(docsDir, fallbackSidebarPath) {
    const ownSidebarPath = path.join(docsDir, sidebarFileName);

    /** @type {import('@docusaurus/plugin-content-docs').SidebarItemsGeneratorOption} */
    return async ({ docs }) => {
        //read it fresh every time, so the dev server picks up edits
        const hasOwnSidebar = fs.existsSync(ownSidebarPath);
        const sidebar = readSidebarFile(hasOwnSidebar ? ownSidebarPath : fallbackSidebarPath);
        const knownIds = new Set(docs.map(x => x.id));
        const allDocs = findDocs(docsDir).filter(x => knownIds.has(idOf(x.file)));
        const existingFiles = new Set(allDocs.map(x => x.file));
        //an older release may keep the same page in a different folder (i.e. `classes.md` before it moved to `language-features/`),
        //so an entry that isn't found by its path falls back to the only page with the same file name
        const filesByBaseName = new Map();
        for (const doc of allDocs) {
            const baseName = baseNameOf(doc.file);
            filesByBaseName.set(baseName, [...(filesByBaseName.get(baseName) ?? []), doc]);
        }
        const resolve = (file) => {
            if (existingFiles.has(file)) {
                return file;
            }
            const sameName = filesByBaseName.get(baseNameOf(file));
            return sameName?.length === 1 ? sameName[0].file : undefined;
        };
        const resolveEntry = (entry) => ({ ...entry, file: resolve(entry.file) });

        const items = sidebar.items
            .map(x => (isCategory(x) ? { label: x.label, items: x.items.map(resolveEntry).filter(y => y.file) } : resolveEntry(x)))
            .filter(x => (isCategory(x) ? x.items.length > 0 : x.file));

        //a borrowed sidebar can't know what this version calls its home page, so the home page (whatever docusaurus serves
        //at the version's root url) goes first if the borrowed sidebar didn't find it
        if (!hasOwnSidebar) {
            const home = docs.find(x => x.frontMatter?.slug === '/') ?? docs.find(x => /^(readme|index)$/i.test(x.id));
            if (home && !entriesOf(items).some(x => idOf(x.file) === home.id)) {
                const homeFile = allDocs.find(x => idOf(x.file) === home.id)?.file;
                if (homeFile) {
                    items.unshift({ file: homeFile, label: 'Introduction' });
                }
            }
        }
        //normally a no-op (sidebar.json is kept in sync), but releases from before sidebar.json existed need the best guess
        placeMissingDocs(items, allDocs);

        const toDoc = (entry) => ({ type: 'doc', id: idOf(entry.file), label: entry.label });
        return items.map(x => (isCategory(x)
            ? { type: 'category', label: x.label, collapsed: false, items: x.items.map(toDoc) }
            : toDoc(x)
        ));
    };
}
