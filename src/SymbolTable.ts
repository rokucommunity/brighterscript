import type { Range } from 'vscode-languageserver';
import type { BscType } from './types/BscType';
import type { GetTypeOptions } from './interfaces';
import { CacheVerifier } from './CacheVerifier';
import type { ReferenceType } from './types/ReferenceType';
import type { UnionType } from './types/UnionType';
import { getUniqueType } from './types/helpers';
import { isReferenceType } from './astUtils/reflection';

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

    private typeCache: Array<Map<string, BscType>>;

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
    addSymbol(name: string, range: Range, type: BscType, bitFlags: SymbolTypeFlag) {
        const key = name.toLowerCase();
        if (!this.symbolMap.has(key)) {
            this.symbolMap.set(key, []);
        }
        this.symbolMap.get(key).push({
            name: name,
            range: range,
            type: type,
            flags: bitFlags
        });
    }

    public getSymbolTypes(name: string, bitFlags: SymbolTypeFlag): BscType[] {
        const symbolArray = this.getSymbol(name, bitFlags);
        if (!symbolArray) {
            return undefined;
        }
        return symbolArray.map(symbol => symbol.type);
    }

    getSymbolType(name: string, options: GetSymbolTypeOptions): BscType {
        let resolvedType = this.getCachedType(name, options);
        const doSetCache = !resolvedType;
        const originalIsReferenceType = isReferenceType(resolvedType);
        if (!resolvedType || originalIsReferenceType) {
            resolvedType = getUniqueType(this.getSymbolTypes(name, options.flags), SymbolTable.unionTypeFactory);
        }
        if (!resolvedType && options.fullName && options.tableProvider) {
            resolvedType = SymbolTable.referenceTypeFactory(name, options.fullName, options.flags, options.tableProvider);
        }
        const newNonReferenceType = originalIsReferenceType && !isReferenceType(resolvedType);
        if (doSetCache || newNonReferenceType || resolvedType) {
            this.setCachedType(name, resolvedType, options);
        }
        return resolvedType;
    }

    setSymbolTypeCache(name: string, resolvedType: BscType, options: GetSymbolTypeOptions) {
        if (resolvedType) {
            this.setCachedType(name, resolvedType, options);
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
                    symbol.range,
                    symbol.type,
                    symbol.flags
                );
            }
        }
    }

    /**
     * Get list of symbols declared directly in this SymbolTable (excludes parent SymbolTable).
     */
    public getOwnSymbols(): BscSymbol[] {
        return [].concat(...this.symbolMap.values());
    }

    /**
     * Get list of all symbols declared in this SymbolTable (includes parent SymbolTable).
     */
    public getAllSymbols(bitFlags: SymbolTypeFlag): BscSymbol[] {
        let symbols = this.getOwnSymbols();
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

    private resetTypeCache() {
        this.typeCache = [
            undefined,
            new Map<string, BscType>(), //SymbolTypeFlags.runtime
            new Map<string, BscType>(), //SymbolTypeFlags.typetime
            new Map<string, BscType>() //SymbolTypeFlags.runtime & SymbolTypeFlags.typetime
        ];
        this.cacheToken = SymbolTable.cacheVerifier?.getToken();
    }

    getCachedType(name: string, options: GetTypeOptions): BscType {
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

    setCachedType(name: string, type: BscType, options: GetTypeOptions) {
        if (!type) {
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
        if (isReferenceType(type) && !isReferenceType(existingCachedValue)) {
            // No need to overwrite a non-referenceType with a referenceType
            return;
        }
        return this.typeCache[options.flags]?.set(name.toLowerCase(), type);
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
                            return { name: x.name, type: x.type?.toString() };
                        });
                    }).flat().sort()
                )
            ]
        };
    }
}

export interface BscSymbol {
    name: string;
    range: Range;
    type: BscType;
    flags: SymbolTypeFlag;
}

export interface SymbolTypeGetter {
    getSymbolType(name: string, options: GetSymbolTypeOptions): BscType;
    setCachedType(name: string, resolvedType: BscType, options: GetSymbolTypeOptions);
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
