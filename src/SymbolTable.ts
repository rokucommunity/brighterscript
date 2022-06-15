import type { Range } from 'vscode-languageserver';
import type { BscType } from './types/BscType';


/**
 * Stores the types associated with variables and functions in the Brighterscript code
 * Can be part of a hierarchy, so lookups can reference parent scopes
 */
export class SymbolTable {
    constructor(
        parent?: SymbolTable | undefined
    ) {
        this.pushParent(parent);
    }

    /**
     * The map of symbols declared directly in this SymbolTable (excludes parent SymbolTable).
     * Indexed by lower symbol name
     */
    private symbolMap = new Map<string, BscSymbol[]>();

    public get parent() {
        return this.parentStack[0];
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
    public getAllSymbols(): BscSymbol[] {
        let symbols = this.getOwnSymbols();
        if (this.parent) {
            symbols = symbols.concat(this.parent.getAllSymbols());
        }
        return symbols;
    }

    /**
     * Sets the parent table for lookups. There can only be one parent at a time, but sometimes you
     * want to temporarily change the parent, and then restore it later. This allows that.
     *
     * @param [parent]
     */
    private parentStack: SymbolTable[] = [];

    public pushParent(parent?: SymbolTable) {
        this.parentStack.unshift(parent);
        return parent;
    }

    /**
     * Remove the current parent, restoring the previous parent (if there was one)
     */
    public popParent() {
        return this.parentStack.shift();
    }

    /**
     * Checks if the symbol table contains the given symbol by name
     * If the identifier is not in this table, it will check the parent
     *
     * @param name the name to lookup
     * @param searchParent should we look to our parent if we don't have the symbol?
     * @returns true if this symbol is in the symbol table
     */
    hasSymbol(name: string, searchParent = true): boolean {
        const key = name.toLowerCase();
        let result = this.symbolMap.has(key);
        if (!result && searchParent) {
            result = !!this.parent?.hasSymbol(key);
        }
        return result;
    }

    /**
     * Gets the name/type pair for a given named variable or function name
     * If the identifier is not in this table, it will check the parent
     *
     * @param  name the name to lookup
     * @param searchParent should we look to our parent if we don't have the symbol?
     * @returns An array of BscSymbols - one for each time this symbol had a type implicitly defined
     */
    getSymbol(name: string, searchParent = true): BscSymbol[] {
        const key = name.toLowerCase();
        let result = this.symbolMap.get(key);
        if (!result && searchParent) {
            result = this.parent?.getSymbol(key);
        }
        return result;
    }

    /**
     * Adds a new symbol to the table
     * @param name
     * @param  type
     */
    addSymbol(name: string, range: Range, type: BscType) {
        const key = name.toLowerCase();
        if (!this.symbolMap.has(key)) {
            this.symbolMap.set(key, []);
        }
        this.symbolMap.get(key).push({
            name: name,
            range: range,
            type: type
        });
    }

    /**
     * Adds all the symbols from another table to this one
     * It will overwrite any existing symbols in this table
     * @param symbolTable
     */
    mergeSymbolTable(symbolTable: SymbolTable) {
        for (let [, value] of symbolTable.symbolMap) {
            for (const symbol of value) {
                this.addSymbol(
                    symbol.name,
                    symbol.range,
                    symbol.type
                );
            }
        }
    }

    clear() {
        this.symbolMap.clear();
    }
}

export interface BscSymbol {
    name: string;
    range: Range;
    type: BscType;
}
