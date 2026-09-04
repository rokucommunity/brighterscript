import type { BrsFile } from './files/BrsFile';
import type { Scope, NamespaceContainer, NamespaceFileContribution } from './Scope';
import { isBrsFile } from './astUtils/reflection';

/**
 * The per-scope namespace lookup. Implements `Map<string, NamespaceContainer>` so existing
 * plugin and internal consumers (which iterate, `.get`, `.has`, `.size`, etc.) keep working.
 *
 * Internally lazy: `get(name)` builds the container for that name only, by intersecting
 * the program-level `(name -> contributing files)` map with the scope's file set.
 *
 * Sharing primitives:
 *  - When exactly one in-scope file contributes to a namespace (the dominant case under
 *    a typical build), the container's heavy fields point directly at the file's pre-built
 *    `NamespaceFileContribution` data — including its symbolTable. Two scopes pulling in
 *    the same file get containers wrapping the same inner data.
 *  - When multiple in-scope files contribute, the container is built per-scope by merging
 *    contributions. This path is rare in practice but must be correct: it covers cases
 *    where a namespace is split across files that are all in the same scope (e.g. a shared
 *    declaration file plus theme-specific extensions).
 *
 * Iteration (`keys` / `values` / `entries` / `forEach`) populates every container, since
 * "give me everything" callers don't benefit from laziness. This matches the cost of the
 * pre-Phase-4 `buildNamespaceLookup` and only fires from LSP completion paths.
 */
export class ScopeNamespaceLookup extends Map<string, NamespaceContainer> {
    constructor(private readonly scope: Scope) {
        super();
    }

    /**
     * Lower-cased name parts contributed by any file in scope. Built once per lookup
     * instance, used as the "does this namespace exist in scope" oracle for `has` and
     * for driving iteration.
     */
    private nameSet: Set<string> | undefined;
    /** Map from lower-cased parent name to lower-cased immediate child names. */
    private childrenByParent: Map<string, string[]> | undefined;
    /** Cached `Set<BrsFile>` for `scope.getAllFiles()`, used when filtering contributors. */
    private inScopeBrsFiles: Set<BrsFile> | undefined;
    /** Set to true after `populateAll` runs so iteration doesn't keep re-checking. */
    private isFullyBuilt = false;

    private ensureNameIndex() {
        if (this.nameSet) {
            return;
        }
        const nameSet = new Set<string>();
        const childrenByParent = new Map<string, string[]>();
        for (const file of this.scope.getAllFiles()) {
            if (isBrsFile(file)) {
                // eslint-disable-next-line @typescript-eslint/dot-notation
                for (const nameLower of file['getNamespaceContributions']().keys()) {
                    nameSet.add(nameLower);
                }
            }
        }
        for (const name of nameSet) {
            const lastDot = name.lastIndexOf('.');
            if (lastDot > 0) {
                const parentLower = name.substring(0, lastDot);
                let arr = childrenByParent.get(parentLower);
                if (!arr) {
                    arr = [];
                    childrenByParent.set(parentLower, arr);
                }
                arr.push(name);
            }
        }
        this.nameSet = nameSet;
        this.childrenByParent = childrenByParent;
    }

    private getInScopeBrsFiles(): Set<BrsFile> {
        if (!this.inScopeBrsFiles) {
            const set = new Set<BrsFile>();
            for (const file of this.scope.getAllFiles()) {
                if (isBrsFile(file)) {
                    set.add(file);
                }
            }
            this.inScopeBrsFiles = set;
        }
        return this.inScopeBrsFiles;
    }

    public override has(key: string): boolean {
        const lower = key?.toLowerCase();
        if (!lower) {
            return false;
        }
        if (super.has(lower)) {
            return super.get(lower) !== undefined;
        }
        this.ensureNameIndex();
        return this.nameSet!.has(lower);
    }

    public override get(key: string): NamespaceContainer | undefined {
        const lower = key?.toLowerCase();
        if (!lower) {
            return undefined;
        }
        if (super.has(lower)) {
            return super.get(lower);
        }
        this.ensureNameIndex();
        if (!this.nameSet!.has(lower)) {
            //memoize the negative result so repeated misses are cheap
            super.set(lower, undefined as any);
            return undefined;
        }
        const container = this.buildContainer(lower);
        super.set(lower, container as any);
        return container;
    }

    public override get size(): number {
        this.ensureNameIndex();
        return this.nameSet!.size;
    }

    public override keys(): IterableIterator<string> {
        this.populateAll();
        return super.keys();
    }

    public override values(): IterableIterator<NamespaceContainer> {
        this.populateAll();
        return super.values();
    }

    public override entries(): IterableIterator<[string, NamespaceContainer]> {
        this.populateAll();
        return super.entries();
    }

    public override [Symbol.iterator](): IterableIterator<[string, NamespaceContainer]> {
        return this.entries();
    }

    public override forEach(
        callback: (value: NamespaceContainer, key: string, map: Map<string, NamespaceContainer>) => void,
        thisArg?: any
    ): void {
        this.populateAll();
        super.forEach(callback, thisArg);
    }

    private populateAll() {
        if (this.isFullyBuilt) {
            return;
        }
        this.ensureNameIndex();
        for (const name of this.nameSet!) {
            this.get(name);
        }
        //drop entries memoized as undefined so iteration only visits real containers
        for (const [key, value] of [...super.entries()]) {
            if (value === undefined) {
                super.delete(key);
            }
        }
        this.isFullyBuilt = true;
    }

    private buildContainer(nameLower: string): NamespaceContainer | undefined {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        const candidateFiles = this.scope.program['getNamespaceContributors'](nameLower);
        if (!candidateFiles || candidateFiles.size === 0) {
            return undefined;
        }
        const inScopeFiles = this.getInScopeBrsFiles();
        const inScopeContributions: NamespaceFileContribution[] = [];
        for (const file of candidateFiles) {
            if (inScopeFiles.has(file)) {
                // eslint-disable-next-line @typescript-eslint/dot-notation
                const contribution = file['getNamespaceContributions']().get(nameLower);
                if (contribution) {
                    inScopeContributions.push(contribution);
                }
            }
        }
        if (inScopeContributions.length === 0) {
            return undefined;
        }
        if (inScopeContributions.length === 1) {
            return this.wrapSingleContribution(inScopeContributions[0], nameLower);
        }
        return this.aggregateContributions(inScopeContributions, nameLower);
    }

    /**
     * Fast path: single in-scope contributor. The wrapper is per-scope (so its
     * `namespaces` field can hold scope-specific children), but every other field
     * points directly at the contribution's pre-built data.
     */
    private wrapSingleContribution(contribution: NamespaceFileContribution, nameLower: string): NamespaceContainer {
        //field order matches the NamespaceContainer interface declaration so the
        //fast-path and slow-path containers share a single V8 hidden class.
        return {
            file: contribution.file,
            fullName: contribution.fullName,
            nameRange: contribution.nameRange,
            lastPartName: contribution.lastPartName,
            namespaces: this.buildScopedChildren(nameLower),
            statements: contribution.statements,
            classStatements: contribution.classStatements,
            functionStatements: contribution.functionStatements,
            enumStatements: contribution.enumStatements,
            constStatements: contribution.constStatements,
            symbolTable: contribution.symbolTable
        };
    }

    /**
     * Slow path: multiple in-scope contributors. The merged statement collections and
     * symbolTable live at the program level (`Program.getAggregateNamespaceContainer`),
     * keyed by `(nameLower, sorted-contributor-pkgPaths)`. Two scopes with the same
     * in-scope file set for this namespace share the same aggregate object, just like
     * the fast path shares the per-file contribution.
     *
     * The wrapper container itself is per-scope so its `namespaces` (children) field can
     * reflect the querying scope's file set.
     */
    private aggregateContributions(contributions: NamespaceFileContribution[], nameLower: string): NamespaceContainer {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        const aggregate = this.scope.program['getAggregateNamespaceContainer'](nameLower, contributions);
        //field order matches the NamespaceContainer interface declaration so fast-path
        //and slow-path containers share a single V8 hidden class
        return {
            file: aggregate.file,
            fullName: aggregate.fullName,
            nameRange: aggregate.nameRange,
            lastPartName: aggregate.lastPartName,
            namespaces: this.buildScopedChildren(nameLower),
            statements: aggregate.statements,
            classStatements: aggregate.classStatements,
            functionStatements: aggregate.functionStatements,
            enumStatements: aggregate.enumStatements,
            constStatements: aggregate.constStatements,
            symbolTable: aggregate.symbolTable
        };
    }

    /**
     * Build the scope-filtered children map for a parent namespace. Walks the
     * pre-computed `childrenByParent` index and recursively materializes each
     * in-scope child container.
     */
    private buildScopedChildren(parentNameLower: string): Map<string, NamespaceContainer> {
        const children = new Map<string, NamespaceContainer>();
        this.ensureNameIndex();
        const childNames = this.childrenByParent!.get(parentNameLower);
        if (!childNames) {
            return children;
        }
        for (const childName of childNames) {
            const child = this.get(childName);
            if (child) {
                children.set(child.lastPartName.toLowerCase(), child);
            }
        }
        return children;
    }
}
