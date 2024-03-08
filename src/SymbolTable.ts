import type { BscType } from './types/BscType';
import type { ExtraSymbolData, GetTypeOptions } from './interfaces';
import { CacheVerifier } from './CacheVerifier';
import type { ReferenceType } from './types/ReferenceType';
import type { UnionType } from './types/UnionType';
import { getUniqueType } from './types/helpers';
import { isAnyReferenceType, isReferenceType } from './astUtils/reflection';
import type { SymbolTypeFlag } from './SymbolTypeFlag';

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
        this.parentProviders.push(provider);
        return () => {
            this.popParentProvider();
        };
    }

    /**
     * Pop the current parentProvider
     */
    public popParentProvider() {
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
    getSymbol(name: string, bitFlags: SymbolTypeFlag): BscSymbol[] {
        let currentTable: SymbolTable = this;
        const key = name?.toLowerCase();
        let result: BscSymbol[];
        let memberOfAncestor = false;
        const addAncestorInfo = (symbol: BscSymbol) => ({ ...symbol, data: { ...symbol.data, memberOfAncestor: memberOfAncestor } });
        do {
            // look in our map first
            if ((result = currentTable.symbolMap.get(key))) {
                // eslint-disable-next-line no-bitwise
                result = result.filter(symbol => symbol.flags & bitFlags);
                if (result.length > 0) {
                    return result.map(addAncestorInfo);
                }
            }
            //look through any sibling maps next
            for (let sibling of currentTable.siblings) {
                result = sibling.getSymbol(key, bitFlags);
                if (result?.length > 0) {
                    return result.map(addAncestorInfo);
                }
            }
            currentTable = currentTable.parent;
            memberOfAncestor = true;
        } while (currentTable);
    }

    /**
     * Adds a new symbol to the table
     */
    addSymbol(name: string, data: ExtraSymbolData, type: BscType, bitFlags: SymbolTypeFlag) {
        const key = name.toLowerCase();
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

    public getSymbolTypes(name: string, options: GetSymbolTypeOptions): TypeCacheEntry[] {
        const symbolArray = this.getSymbol(name, options.flags);
        if (!symbolArray) {
            return undefined;
        }
        return symbolArray?.map(symbol => ({ type: symbol.type, data: symbol.data, flags: symbol.flags }));
    }

    getSymbolType(name: string, options: GetSymbolTypeOptions): BscType {
        const cacheEntry = options.ignoreCacheForRetrieval ? undefined : this.getCachedType(name, options);
        let resolvedType = cacheEntry?.type;
        let doSetCache = !resolvedType;
        const originalIsReferenceType = isAnyReferenceType(resolvedType);
        let data = cacheEntry?.data || {} as ExtraSymbolData;
        let foundFlags: SymbolTypeFlag = cacheEntry?.flags;
        if (!resolvedType || originalIsReferenceType) {
            const symbolTypes = this.getSymbolTypes(name, options);
            data = symbolTypes?.[0]?.data;
            foundFlags = symbolTypes?.[0].flags;
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
        }
        return resolvedType;
    }

    /**
     * Adds all the symbols from another table to this one
     * It will overwrite any existing symbols in this table
     */
    mergeSymbolTable(symbolTable: SymbolTable) {
        for (let [, value] of symbolTable.symbolMap) {
            for (const symbol of value) {
                this.addSymbol(
                    symbol.name,
                    symbol.data,
                    symbol.type,
                    symbol.flags
                );
            }
        }
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

    /**
     * Get list of all symbols declared in this SymbolTable (includes parent SymbolTable).
     */
    public getAllSymbols(bitFlags: SymbolTypeFlag): BscSymbol[] {
        let symbols: BscSymbol[] = [].concat(...this.symbolMap.values());
        //look through any sibling maps next
        for (let sibling of this.siblings) {
            symbols = symbols.concat(sibling.getAllSymbols(bitFlags));
        }
        if (this.parent) {
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
