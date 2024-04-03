import * as micromatch from 'micromatch';
import * as path from 'path';

/**
 * Manage collections of glob patterns used to filter paths.
 *
 * excludeLists are evaluated first to see if a path should be excluded. If the path is excluded, we then test it against the includeLists.
 * If the path matches an includeList, it will be included. If not, it will remain excluded.
 */
export class PathFilterer {

    private includeCollections: PathCollection[] = [];

    private excludeCollections: PathCollection[] = [];

    /**
     * Filter the given list of entries based on the registered include and exclude lists.
     * @param entries the list of paths (or objects having paths) to filter
     * @param fetcher a function that can extract the path from the entry if it's not a string
     * @returns the filtered list of entries
     */
    public filter<T = string>(entries: T[], fetcher?: (path: T) => string) {
        //if there are no exclude lists, then all files should be included
        if (this.excludeCollections.length === 0) {
            return entries;
        }

        let results: T[] = [];

        //process each path
        for (let entry of entries) {
            let srcPath = fetcher?.(entry) ?? entry as unknown as string;

            //if this path is excluded
            if (this.isExclusionsMatch(srcPath)) {
                //if this path is re-included, keep it
                if (this.isInclusionsMatch(srcPath)) {
                    results.push(entry);
                } else {
                    //this path should be excluded
                }

                //this path is not excluded, so keep it
            } else {
                results.push(entry);
            }
        }
        return results;
    }

    /**
     * Does the path match at least one of the exclusions lists
     */
    private isExclusionsMatch(path: string) {
        //does this path match an exclusion list?
        for (const collection of this.excludeCollections) {
            if (collection.isMatch(path)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Does the path match at least one of the inclusions lists
     */
    private isInclusionsMatch(path: string) {
        //does this path match an exclusion list?
        for (const collection of this.includeCollections) {
            if (collection.isMatch(path)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Register a list of inclusive globs that should be evaluated together
     * These should be things like the `files` array from a bsconfig.json
     */
    public registerIncludeList(rootDir: string, globs: string[]) {
        let collection = new PathCollection({
            rootDir: rootDir,
            globs: globs
        });
        this.includeCollections.push(collection);
        return () => {
            this.removeCollection(collection);
        };
    }

    /**
     * Register glob patterns for files that should be _excluded_. positive patterns mean a file is excluded,
     * and negative patterns mean a file that was previously matched (excluded) should be unmatched (included)
     * These should be things like .gitignore or vscode's `files.exclude`.
     *
     * @example
     * ```typescript
     * [
     *     '.git',
     *     'node_modules'
     *     '!node_modules/@rokucommunity/bslib'
     * ]
     * ```
     * would exclude all files in the `.git` and `node_modules` directories, but would include the `node_modules/@rokucommunity/bslib` directory
     */
    public registerExcludeList(rootDir: string, globs: string[]) {
        let collection = new PathCollection({
            rootDir: rootDir,
            globs: globs
        });
        this.excludeCollections.push(collection);
        return () => {
            this.removeCollection(collection);
        };
    }

    public registerExcludeMatcher(matcher: (path: string) => boolean) {
        const collection = new PathCollection({
            matcher: matcher
        });
        return () => {
            this.removeCollection(collection);
        };
    }

    private removeCollection(collection: PathCollection) {
        let idx = this.includeCollections.indexOf(collection);
        if (idx > -1) {
            this.includeCollections.splice(idx, 1);
        }
        idx = this.excludeCollections.indexOf(collection);
        if (idx > -1) {
            this.excludeCollections.splice(idx, 1);
        }
    }

    /**
     * Remove all registered collections
     */
    public clear() {
        this.includeCollections = [];
        this.excludeCollections = [];
    }
}

export class PathCollection {
    constructor(options: {
        rootDir: string;
        globs: string[];
    } | {
        matcher: (path: string) => boolean;
    }) {
        if ('globs' in options) {
            //build matcher patterns from the globs
            for (const glob of options.globs ?? []) {
                const pattern = path.resolve(
                    path.posix.join(
                        options.rootDir,
                        glob
                    )
                ).replace(/\\+/g, '/');
                this.matchers.push(
                    micromatch.matcher(pattern)
                );
            }
        } else {
            this.matchers.push(options.matcher);
        }
    }

    private matchers: Array<(string) => boolean> = [];
    public isMatch(path: string) {
        for (let matcher of this.matchers) {
            if (matcher(path)) {
                return true;
            }
        }
        return false;
    }
}
