import type { BscType } from './types/BscType';
import type { ExtraSymbolData, GetTypeOptions } from './interfaces';
import { CacheVerifier } from './CacheVerifier';
import type { ReferenceType } from './types/ReferenceType';
import type { UnionType } from './types/UnionType';
import { getUniqueType } from './types/helpers';
import { isAnyReferenceType, isNamespaceType, isReferenceType } from './astUtils/reflection';
import { SymbolTypeFlag } from './SymbolTypeFlag';

/**
 * Stores the types associated with variables and functions in the Brighterscript code
 * Can be part of a hierarchy, so lookups can reference parent scopes
 */
export class SymbolTable implements SymbolTypeGetter {
    constructor(
        public name: string,
        parentProvider?: SymbolTableProvider
    ) {
        this.resetTypeCache();
        if (parentProvider) {
            this.pushParentProvider(parentProvider);
        }
    }

    /**
     * The map of symbols declared directly in this SymbolTable (excludes parent SymbolTable).
     * Indexed by lower symbol name
     */
    private symbolMap = new Map<string, BscSymbol[]>();

    private parentProviders = [] as SymbolTableProvider[];

    private cacheToken: string;

    private typeCache: Array<Map<string, TypeCacheEntry>>;

    private pocketTables = new Array<PocketTable>();

    /**
     * Used to invalidate the cache for all symbol tables.
     *
     * This is not the most optimized solution as cache will be shared across all instances of SymbolTable across all programs,
     * but this is the easiest way to handle nested/linked symbol table cache management so we can optimize this in the future some time...
     */
    static cacheVerifier = new CacheVerifier();

    static referenceTypeFactory: (memberKey: string, fullName, flags: SymbolTypeFlag, tableProvider: SymbolTypeGetterProvider) => ReferenceType;
    static unionTypeFactory: (types: BscType[]) => UnionType;

    /**
     * Push a function that will provide a parent SymbolTable when requested
     */
    public pushParentProvider(provider: SymbolTableProvider) {
        this.cachedCircularReferenceCheck = null;
        this.parentProviders.push(provider);
        return () => {
            this.popParentProvider();
        };
    }

    /**
     * Pop the current parentProvider
     */
    public popParentProvider() {
        this.cachedCircularReferenceCheck = null;
        this.parentProviders.pop();
    }

    /**
     * The parent SymbolTable (if there is one)
     */
    public get parent(): SymbolTable | undefined {
        return this.parentProviders[this.parentProviders.length - 1]?.();
    }

    private siblings = new Set<SymbolTable>();

    /**
     * Add a sibling symbol table (which will be inspected first before walking upward to the parent
     */
    public addSibling(sibling: SymbolTable) {
        this.siblings.add(sibling);
        return () => {
            this.siblings.delete(sibling);
        };
    }

    /**
     * Remove a sibling symbol table
     */
    public removeSibling(sibling: SymbolTable) {
        this.siblings.delete(sibling);
    }


    public addPocketTable(pocketTable: PocketTable) {
        this.pocketTables.push(pocketTable);
    }

    public getStatementIndexOfPocketTable(symbolTable: SymbolTable) {
        return this.pocketTables.find(pt => pt.table === symbolTable)?.index ?? -1;
    }

    public clearSymbols() {
        this.symbolMap.clear();
    }

    /**
     * Checks if the symbol table contains the given symbol by name
     * If the identifier is not in this table, it will check the parent
     *
     * @param name the name to lookup
     * @param bitFlags flags to match (See SymbolTypeFlags)
     * @returns true if this symbol is in the symbol table
     */
    hasSymbol(name: string, bitFlags: SymbolTypeFlag): boolean {
        let currentTable: SymbolTable = this;
        const key = name?.toLowerCase();
        let result: BscSymbol[];
        do {
            // look in our map first
            if ((result = currentTable.symbolMap.get(key))) {
                // eslint-disable-next-line no-bitwise
                if (result.find(symbol => symbol.flags & bitFlags)) {
                    return true;
                }
            }

            //look through any sibling maps next
            for (let sibling of currentTable.siblings) {
                if ((result = sibling.symbolMap.get(key))) {
                    // eslint-disable-next-line no-bitwise
                    if (result.find(symbol => symbol.flags & bitFlags)) {
                        return true;
                    }
                }
            }
            currentTable = currentTable.parent;
        } while (currentTable);
        return false;
    }

    /**
     * Gets the name/type pair for a given named variable or function name
     * If the identifier is not in this table, it will check the parent
     *
     * @param  name the name to lookup
     * @param bitFlags flags to match
     * @returns An array of BscSymbols - one for each time this symbol had a type implicitly defined
     */
    getSymbol(name: string, bitFlags: SymbolTypeFlag, additionalOptions: { ignoreParentsAndSiblings?: boolean; beforeStatementIndex?: number } = {}): BscSymbol[] {
        let currentTable: SymbolTable = this;
        let previousTable: SymbolTable;
        const key = name?.toLowerCase();
        let result: BscSymbol[];
        let memberOfAncestor = false;
        const addAncestorInfo = (symbol: BscSymbol) => ({ ...symbol, data: { ...symbol.data, memberOfAncestor: memberOfAncestor } });
        let beforeStatementIndex = Number.isInteger(additionalOptions?.beforeStatementIndex) ? additionalOptions.beforeStatementIndex : -1;
        const filterByStatementIndex = (t: BscSymbol) => {
            if (beforeStatementIndex >= 0) {
                return t.data?.definingNode ? t.data.definingNode.statementIndex < beforeStatementIndex : true;

            }
            return true;
        };

        do {

            if (previousTable) {
                beforeStatementIndex = currentTable.getStatementIndexOfPocketTable(previousTable);
            }

            // look in our map first
            if ((result = currentTable.symbolMap.get(key))) {
                // eslint-disable-next-line no-bitwise
                result = result.filter(symbol => symbol.flags & bitFlags).filter(filterByStatementIndex);
                if (result.length > 0) {
                    return result.map(addAncestorInfo);
                }
            }

            if (additionalOptions?.ignoreParentsAndSiblings) {
                break;
            }
            //look through any sibling maps next
            for (let sibling of currentTable.siblings) {
                result = sibling.getSymbol(key, bitFlags);
                if (result?.length > 0) {
                    return result.map(addAncestorInfo);
                }
            }
            previousTable = currentTable;
            currentTable = currentTable.parent;
            memberOfAncestor = true;
        } while (currentTable);
        return result;
    }

    /**
     * Adds a new symbol to the table
     */
    addSymbol(name: string, data: ExtraSymbolData, type: BscType, bitFlags: SymbolTypeFlag) {
        if (!name) {
            return;
        }
        const key = name?.toLowerCase();
        if (!this.symbolMap.has(key)) {
            this.symbolMap.set(key, []);
        }
        this.symbolMap.get(key)?.push({
            name: name,
            data: data,
            type: type,
            flags: bitFlags
        });
    }

    /**
     * Removes a new symbol from the table
     */
    removeSymbol(name: string) {
        const key = name.toLowerCase();
        if (!this.symbolMap.has(key)) {
            this.symbolMap.set(key, []);
        }
        this.symbolMap.delete(key);
    }

    public getSymbolTypes(name: string, options: GetSymbolTypeOptions, sortByStatementIndex = false): TypeCacheEntry[] {
        const symbolArray = this.getSymbol(name, options.flags, { ignoreParentsAndSiblings: options.ignoreParentTables, beforeStatementIndex: Number.isInteger(options.statementIndex) ? options.statementIndex as number : -1 });
        if (!symbolArray) {
            return undefined;
        }
        const symbols = symbolArray?.map(symbol => ({ type: symbol.type, data: symbol.data, flags: symbol.flags }));

        if (sortByStatementIndex) {
            symbols.sort((a, b) => {
                if (!Number.isInteger(a.data?.definingNode?.statementIndex)) {
                    return -1;
                }
                if (!Number.isInteger(b.data?.definingNode?.statementIndex)) {
                    return 1;
                }
                if (b.data.definingNode.statementIndex > a.data.definingNode.statementIndex) {
                    return -1;
                }
                if (b.data.definingNode.statementIndex < a.data.definingNode.statementIndex) {
                    return 1;
                }
                return -1;
            });
        }
        return symbols;
    }

    getSymbolType(name: string, options: GetSymbolTypeOptions): BscType {
        const cacheEntry = options.ignoreCacheForRetrieval ? undefined : this.getCachedType(name, options);
        let resolvedType = cacheEntry?.type;
        let doSetCache = !resolvedType;
        const originalIsReferenceType = isAnyReferenceType(resolvedType);
        let data = cacheEntry?.data || {} as ExtraSymbolData;
        let foundFlags: SymbolTypeFlag = cacheEntry?.flags;
        if (!resolvedType || originalIsReferenceType) {
            let symbolTypes: TypeCacheEntry[];
            // eslint-disable-next-line no-bitwise
            if (this.hasValidStatementIndex(options) && (options.flags & SymbolTypeFlag.runtime)) {
                symbolTypes = this.getPossibleTypesByStatement(name, { ...options, statementIndex: options.statementIndex });
                doSetCache = false;
            } else {
                symbolTypes = this.getSymbolTypes(name, options);
            }
            data = symbolTypes?.[0]?.data;
            foundFlags = symbolTypes?.[0]?.flags;
            resolvedType = getUniqueType(symbolTypes?.map(symbol => symbol.type), SymbolTable.unionTypeFactory);
        }
        if (!resolvedType && options.fullName && options.tableProvider) {
            resolvedType = SymbolTable.referenceTypeFactory(name, options.fullName, options.flags, options.tableProvider);
        }
        const resolvedTypeIsReference = isAnyReferenceType(resolvedType);
        const newNonReferenceType = originalIsReferenceType && !isAnyReferenceType(resolvedType);
        doSetCache = doSetCache && (options.onlyCacheResolvedTypes ? !resolvedTypeIsReference : true);
        if (doSetCache || newNonReferenceType) {
            this.setCachedType(name, { type: resolvedType, data: data, flags: foundFlags }, options);
        }
        options.data ??= {};
        if (options.data) {
            options.data.definingNode = data?.definingNode;
            options.data.description = data?.description;
            options.data.flags = foundFlags ?? options.flags;
            options.data.memberOfAncestor = data?.memberOfAncestor;
            options.data.doNotMerge = data?.doNotMerge;
            options.data.isAlias = data?.isAlias;
            options.data.isInstance = data?.isInstance;
            options.data.isFromDocComment = data?.isFromDocComment;
            options.data.isBuiltIn = data?.isBuiltIn;
            options.data.isFromCallFunc = data?.isFromCallFunc;
        }
        return resolvedType;
    }

    isSymbolTypeInstance(name: string) {
        const data: ExtraSymbolData = {};
        this.getSymbolType(name, { flags: SymbolTypeFlag.runtime, data: data });
        return data?.isInstance;
    }

    /**
     * Adds all the symbols from another table to this one
     * It will overwrite any existing symbols in this table
     */
    mergeSymbolTable(symbolTable: SymbolTable) {
        for (let [, value] of symbolTable.symbolMap) {
            for (const symbol of value) {
                if (symbol.data?.doNotMerge) {
                    continue;
                }
                this.addSymbol(
                    symbol.name,
                    symbol.data,
                    symbol.type,
                    symbol.flags
                );
            }
        }
    }

    mergeNamespaceSymbolTables(symbolTable: SymbolTable) {
        const disposables = [] as Array<() => void>;
        for (let [_name, value] of symbolTable.symbolMap) {
            const symbol = value[0];
            if (symbol) {
                if (symbol.data?.doNotMerge) {
                    continue;
                }
                const existingRuntimeType = this.getSymbolType(symbol.name, { flags: symbol.flags });

                if (isNamespaceType(existingRuntimeType) && isNamespaceType(symbol.type)) {
                    disposables.push(...existingRuntimeType.memberTable.mergeNamespaceSymbolTables(symbol.type.memberTable));
                } else {
                    this.addSymbol(
                        symbol.name,
                        symbol.data,
                        symbol.type,
                        symbol.flags
                    );
                    disposables.push(() => this.removeSymbol(symbol.name));
                }
            }
        }

        for (let siblingTable of symbolTable.siblings) {
            disposables.push(...this.mergeNamespaceSymbolTables(siblingTable));
        }
        return disposables;
    }

    /**
     * Get list of symbols declared directly in this SymbolTable (excludes parent SymbolTable).
     */
    public getOwnSymbols(bitFlags: SymbolTypeFlag): BscSymbol[] {
        let symbols: BscSymbol[] = [].concat(...this.symbolMap.values());
        // eslint-disable-next-line no-bitwise
        symbols = symbols.filter(symbol => symbol.flags & bitFlags);
        return symbols;
    }


    private cachedCircularReferenceCheck: null | boolean = null;

    private hasCircularReferenceWithAncestor() {
        if (this.cachedCircularReferenceCheck === false || this.cachedCircularReferenceCheck === true) {
            return this.cachedCircularReferenceCheck;
        }
        let foundCircReference = false;
        let p = this.parent;
        while (!foundCircReference && p) {
            foundCircReference = p === this;
            p = p.parent;
        }
        this.cachedCircularReferenceCheck = foundCircReference;
        return foundCircReference;
    }

    /**
     * Get list of all symbols declared in this SymbolTable (includes parent SymbolTable).
     */
    public getAllSymbols(bitFlags: SymbolTypeFlag): BscSymbol[] {
        let symbols: BscSymbol[] = [].concat(...this.symbolMap.values());
        //look through any sibling maps next
        for (let sibling of this.siblings) {
            symbols = symbols.concat(sibling.getAllSymbols(bitFlags));
        }

        if (this.parent && !this.hasCircularReferenceWithAncestor()) {
            symbols = symbols.concat(this.parent.getAllSymbols(bitFlags));
        }
        // eslint-disable-next-line no-bitwise
        symbols = symbols.filter(symbol => symbol.flags & bitFlags);

        //remove duplicate symbols
        const symbolsMap = new Map<string, BscSymbol>();
        for (const symbol of symbols) {
            const lowerSymbolName = symbol.name.toLowerCase();
            if (!symbolsMap.has(lowerSymbolName)) {
                symbolsMap.set(lowerSymbolName, symbol);
            }
        }
        return [...symbolsMap.values()];
    }

    private resetTypeCache() {
        this.typeCache = [
            undefined,
            new Map<string, TypeCacheEntry>(), // SymbolTypeFlags.runtime
            new Map<string, TypeCacheEntry>(), // SymbolTypeFlags.typetime
            new Map<string, TypeCacheEntry>() // SymbolTypeFlags.runtime & SymbolTypeFlags.typetime
        ];
        this.cacheToken = SymbolTable.cacheVerifier?.getToken();
    }

    getCachedType(name: string, options: GetTypeOptions): TypeCacheEntry {
        if (SymbolTable.cacheVerifier) {
            if (!SymbolTable.cacheVerifier?.checkToken(this.cacheToken)) {
                // we have a bad token
                this.resetTypeCache();
                return;
            }
        } else {
            // no cache verifier
            return;
        }
        return this.typeCache[options.flags]?.get(name.toLowerCase());
    }

    setCachedType(name: string, cacheEntry: TypeCacheEntry, options: GetTypeOptions) {
        if (!cacheEntry) {
            return;
        }
        if (SymbolTable.cacheVerifier) {
            if (!SymbolTable.cacheVerifier?.checkToken(this.cacheToken)) {
                // we have a bad token - remove all other caches
                this.resetTypeCache();
            }
        } else {
            // no cache verifier
            return;
        }
        let existingCachedValue = this.typeCache[options.flags]?.get(name.toLowerCase());
        if (isReferenceType(cacheEntry.type) && !isReferenceType(existingCachedValue)) {
            // No need to overwrite a non-referenceType with a referenceType
            return;
        }
        return this.typeCache[options.flags]?.set(name.toLowerCase(), cacheEntry);
    }

    /**
     * Serialize this SymbolTable to JSON (useful for debugging reasons)
     */
    private toJSON() {
        return {
            name: this.name,
            siblings: [...this.siblings].map(sibling => sibling.toJSON()),
            parent: this.parent?.toJSON(),
            symbols: [
                ...new Set(
                    [...this.symbolMap.entries()].map(([key, symbols]) => {
                        return symbols.map(x => {
                            return { name: x.name, type: (x.type as any)?.__identifier };
                        });
                    }).flat().sort()
                )
            ]
        };
    }

    private hasValidStatementIndex(options: GetSymbolTypeOptions) {
        return options.statementIndex === 'end' || (Number.isInteger(options.statementIndex) && options.statementIndex > -1);
    }

    public getPossibleTypesByStatement(name: string, options: { statementIndex: number | 'end' } & GetSymbolTypeOptions, depth = 0): TypeCacheEntry[] {
        const symbolTypes = this.getSymbolTypes(name, { ...options, ignoreParentTables: (depth > 0) }, true) ?? [];

        const precedingAssignmentType = symbolTypes[symbolTypes.length - 1];
        //options.statementIndex === 'end'
        //  ? symbolTypes[symbolTypes.length - 1]
        // : symbolTypes.findLast(st => {
        //    const nodeIndex = st.data?.definingNode?.statementIndex ?? -1;
        //    return (options.statementIndex as number) > nodeIndex;
        // });
        if (!precedingAssignmentType) {
            // uh-oh, potential use of uninitialized variable!
        }
        const result = precedingAssignmentType ? [
            precedingAssignmentType
        ] : [];

        const pocketTablesBetweenAssignmentAndPosition = this.pocketTables.filter(pt => {
            const isBeforePosition = options.statementIndex === 'end' ? true : options.statementIndex > pt.index;
            let isAfterPrecedingAssignment = true;
            if (precedingAssignmentType) {
                isAfterPrecedingAssignment = precedingAssignmentType.data.definingNode.statementIndex < pt.index;
            }
            return isAfterPrecedingAssignment && isBeforePosition;
        });

        for (const pocketTable of pocketTablesBetweenAssignmentAndPosition) {
            const pocketTableTypes = pocketTable.table.getPossibleTypesByStatement(name, { ...options, statementIndex: 'end' }, depth + 1);
            result.push(...pocketTableTypes);
        }

        return result;
    }
}

export interface BscSymbol {
    name: string;
    data: ExtraSymbolData;
    type: BscType;
    flags: SymbolTypeFlag;
}

export interface BscSymbolWithSource extends BscSymbol {
    comesFromAncestor: boolean; // this symbol comes from an ancestor symbol table
}

export interface SymbolTypeGetter {
    name: string;
    getSymbolType(name: string, options: GetSymbolTypeOptions): BscType;
    setCachedType(name: string, cacheEntry: TypeCacheEntry, options: GetSymbolTypeOptions);
    addSibling(symbolTable: SymbolTable);
}

/**
 * A function that returns a symbol table.
 */
export type SymbolTableProvider = () => SymbolTable;

/**
 * A function that returns a symbol types getter - smaller interface used in types
 */
export type SymbolTypeGetterProvider = () => SymbolTypeGetter;


export interface GetSymbolTypeOptions extends GetTypeOptions {
    fullName?: string;
    tableProvider?: SymbolTableProvider;
}

export interface TypeCacheEntry {
    type: BscType;
    data?: ExtraSymbolData;
    flags?: SymbolTypeFlag;
}

export interface PocketTable {
    table: SymbolTable;
    /**
     * The index of the statement that contains this table within its parent block
     */
    index: number;
}
