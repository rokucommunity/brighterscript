import type { Range } from 'vscode-languageserver';
import type { BscType } from './types/BscType';


export enum SymbolTypeFlags {
    runtime = 1,
    typetime = 2
}

/**
 * Stores the types associated with variables and functions in the Brighterscript code
 * Can be part of a hierarchy, so lookups can reference parent scopes
 */
export class SymbolTable {
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

    /**
     * Push a function that will provide a parent SymbolTable when requested
     */
    public pushParentProvider(provider: SymbolTableProvider) {
        this.parentProviders.push(provider);
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
     * @param bitFlags flags to match
     * @returns true if this symbol is in the symbol table
     */
    hasSymbol(name: string, bitFlags = SymbolTypeFlags.runtime): boolean {
        return !!this.getSymbol(name, bitFlags);
    }

    /**
     * Gets the name/type pair for a given named variable or function name
     * If the identifier is not in this table, it will check the parent
     *
     * @param  name the name to lookup
     * @param bitFlags flags to match
     * @returns An array of BscSymbols - one for each time this symbol had a type implicitly defined
     */
    getSymbol(name: string, bitFlags = SymbolTypeFlags.runtime): BscSymbol[] {
        const key = name.toLowerCase();
        let result: BscSymbol[];
        // look in our map first
        if ((result = this.symbolMap.get(key))) {
            result = result.filter(symbol => symbol.flags & bitFlags)
            if (result.length > 0) {
                return result;
            }
        }
        //look through any sibling maps next
        for (let sibling of this.siblings) {
            if ((result = sibling.symbolMap.get(key))) {
                result = result.filter(symbol => symbol.flags & bitFlags)
                if (result.length > 0) {
                    return result;
                }
            }
        }
        // ask our parent for a symbol
        if (result = this.parent?.getSymbol(key, bitFlags)) {
            return result;
        }
    }

    /**
     * Adds a new symbol to the table
     */
    addSymbol(name: string, range: Range, type: BscType, bitFlags = SymbolTypeFlags.runtime) {
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
     * Serialize this SymbolTable to JSON (useful for debugging reasons)
     */
    private toJSON() {
        return {
            name: this.name,
            parent: this.parent?.toJSON(),
            symbols: [
                ...new Set(
                    [...this.symbolMap.entries()].map(([key, symbols]) => {
                        return symbols.map(x => x.name);
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
    flags: number;
}

/**
 * A function that returns a symbol table.
 */
export type SymbolTableProvider = () => SymbolTable;
