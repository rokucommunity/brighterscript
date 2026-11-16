/**
 * The docs sidebar, driven by `docs/sidebar.json`.
 *
 * The sidebar order is also the order of the "Previous" / "Next" buttons, so it should read like a book.
 * docs/sidebar.json lives next to the markdown (not in the website tooling), so every version branch owns its own order.
 * Each entry's `file` is the markdown file's path within docs/ (i.e. `language-features/classes.md`).
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
 * @typedef {{ file: string; title: string }} DocInfo
 */

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
 * Put every doc that isn't in the sidebar yet where it most likely belongs. Returns where each one went.
 * @param {SidebarCategory[]} categories (modified in place)
 * @param {DocInfo[]} allDocs
 */
export function placeMissingDocs(categories, allDocs) {
    const listed = new Set(categories.flatMap(c => c.items.map(x => x.file)));
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
            }
            best = { category: other, index: other.items.length - 1, reason: 'no similar pages' };
        }
        best.category.items.splice(best.index + 1, 0, {
            file: doc.file,
            //"BrighterScript Classes" -> "Classes"
            label: doc.title.replace(/^BrighterScript\s+/i, '') || idOf(doc.file)
        });
        placements.push({ file: doc.file, category: best.category.label, reason: best.reason });
    }
    return placements;
}

function readSidebarFile(sidebarPath) {
    return fs.existsSync(sidebarPath) ? JSON.parse(fs.readFileSync(sidebarPath, 'utf8')) : { categories: [] };
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
    for (const category of sidebar.categories) {
        category.items = category.items.filter(item => {
            if (!existingFiles.has(item.file)) {
                removed.push(item.file);
                return false;
            }
            return true;
        });
    }
    sidebar.categories = sidebar.categories.filter(x => x.items.length > 0);
    const added = placeMissingDocs(sidebar.categories, docs);

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
    const other = sidebar.categories.find(x => x.label === otherCategoryLabel)?.items.map(x => x.file) ?? [];
    return { sidebarPath: sidebarPath, added: added, removed: removed, other: other };
}

/**
 * The docusaurus `sidebarItemsGenerator` for a version, built from that version's sidebar.json
 * (or `fallbackSidebarPath`, for releases from before sidebar.json existed)
 */
export function createSidebarItemsGenerator(docsDir, fallbackSidebarPath) {
    const ownSidebarPath = path.join(docsDir, sidebarFileName);
    const sidebar = readSidebarFile(fs.existsSync(ownSidebarPath) ? ownSidebarPath : fallbackSidebarPath);

    /** @type {import('@docusaurus/plugin-content-docs').SidebarItemsGeneratorOption} */
    return async ({ docs }) => {
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

        const categories = sidebar.categories
            .map(c => ({
                label: c.label,
                items: c.items.map(x => ({ ...x, file: resolve(x.file) })).filter(x => x.file)
            }))
            .filter(c => c.items.length > 0);
        //normally a no-op (sidebar.json is kept in sync), but releases from before sidebar.json existed need the best guess
        placeMissingDocs(categories, allDocs);

        return categories.map(category => ({
            type: 'category',
            label: category.label,
            collapsed: false,
            items: category.items.map(x => ({ type: 'doc', id: idOf(x.file), label: x.label }))
        }));
    };
}
