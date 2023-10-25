import type { BscType } from './types/BscType';
import type { ExtraSymbolData, GetTypeOptions } from './interfaces';
import type { ReferenceType } from './types/ReferenceType';
import type { UnionType } from './types/UnionType';
import { getUniqueType } from './types/helpers';
import { isAnyReferenceType } from './astUtils/reflection';
import type { TypeCacheEntry } from './TypeCache';
import { TypeCache } from './TypeCache';

export enum SymbolTypeFlag {
    runtime = 1,
    typetime = 2
}

/**
 * Stores the types associated with variables and functions in the Brighterscript code
 * Can be part of a hierarchy, so lookups can reference parent scopes
 */
export class SymbolTable implements SymbolTypeGetter {
    constructor(
        public name: string,
        parentProvider?: SymbolTableProvider
    ) {
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

    private typeCache = new TypeCache();

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
    public get parent() {
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
        do {
            // look in our map first
            if ((result = currentTable.symbolMap.get(key))) {
                // eslint-disable-next-line no-bitwise
                result = result.filter(symbol => symbol.flags & bitFlags);
                if (result.length > 0) {
                    return result;
                }
            }
            //look through any sibling maps next
            for (let sibling of currentTable.siblings) {
                result = sibling.getSymbol(key, bitFlags);
                if (result) {
                    if (result.length > 0) {
                        return result;
                    }
                }
            }
            currentTable = currentTable.parent;
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
        this.symbolMap.get(key).push({
            name: name,
            data: data,
            type: type,
            flags: bitFlags
        });
    }

    /**
     * Removes a new symbol from the table
     */
    removeSymbol(name: string, options?: GetSymbolTypeOptions) {
        const key = name.toLowerCase();
        if (!this.symbolMap.has(key)) {
            this.symbolMap.set(key, []);
        }
        this.symbolMap.delete(key);
        this.typeCache.clearCachedType(key, options);
    }

    public getSymbolTypes(name: string, options: GetSymbolTypeOptions): TypeCacheEntry[] {
        const symbolArray = this.getSymbol(name, options.flags);
        if (!symbolArray) {
            return undefined;
        }
        return symbolArray?.map(symbol => ({ type: symbol.type, data: symbol.data }));
    }

    getSymbolType(name: string, options: GetSymbolTypeOptions): BscType {
        const cacheEntry = this.getCachedType(name, options);
        let resolvedType = cacheEntry?.type;
        const doSetCache = !resolvedType;
        const originalIsReferenceType = isAnyReferenceType(resolvedType);
        let data = cacheEntry?.data ?? {} as ExtraSymbolData;
        if (!resolvedType || originalIsReferenceType) {
            const symbolTypes = this.getSymbolTypes(name, options);
            data = symbolTypes?.[0]?.data;
            resolvedType = getUniqueType(symbolTypes?.map(symbol => symbol.type), SymbolTable.unionTypeFactory);
        }
        if (!resolvedType && options.fullName && options.tableProvider) {
            resolvedType = SymbolTable.referenceTypeFactory(name, options.fullName, options.flags, options.tableProvider);
        }
        const newNonReferenceType = originalIsReferenceType && !isAnyReferenceType(resolvedType);
        if (doSetCache || newNonReferenceType) {
            this.setCachedType(name, { type: resolvedType, data: data }, options);
        }
        if (options.data) {
            options.data.definingNode = data?.definingNode;
            options.data.description = data?.description;
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
        if (this.parent) {
            symbols = symbols.concat(this.parent.getOwnSymbols(bitFlags));
        }
        return symbols;
    }

    /**
     * Get list of all symbols declared in this SymbolTable (includes parent SymbolTable).
     */
    public getAllSymbols(bitFlags: SymbolTypeFlag): BscSymbol[] {
        let symbols = [].concat(...this.symbolMap.values());
        //look through any sibling maps next
        for (let sibling of this.siblings) {
            symbols = symbols.concat(sibling.getAllSymbols(bitFlags));
        }
        if (this.parent) {
            symbols = symbols.concat(this.parent.getAllSymbols(bitFlags));
        }
        // eslint-disable-next-line no-bitwise
        return symbols.filter(symbol => symbol.flags & bitFlags);
    }


    getCachedType(name: string, options: GetTypeOptions): TypeCacheEntry {
        return this.typeCache.getCachedType(name, options);
    }

    setCachedType(name: string, cacheEntry: TypeCacheEntry, options: GetTypeOptions) {
        return this.typeCache.setCachedType(name, cacheEntry, options);
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

export interface SymbolTypeGetter {
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

