import type { Identifier } from './lexer/Token';
import type { BscType } from './types/BscType';

export interface BscSymbol {
    name: Identifier;
    type: BscType;
}

/**
 * Stores the types associated with variables and functions in the Brighterscript code
 * Can be part of a hierarchy, so lookups can reference parent scopes
 */
export class SymbolTable {

    private symbols = new Map<string, BscSymbol[]>();

    constructor(
        private parent?: SymbolTable | undefined
    ) { }

    /**
     * Sets the parent table for lookups
     *
     * @param {SymbolTable} [parent]
     */
    setParent(parent?: SymbolTable) {
        this.parent = parent;
    }

    /**
     * Gets the name/type pair for a given named variable or function name
     * If the identifier is not in this table, it will check the parent
     *
     * @param {(Identifier | string)} name the name to lookup
     * @returns {BscSymbol}
     */
    getSymbol(name: Identifier | string): BscSymbol {
        const key = this.standardizeKey(name);
        return this.symbols.get(key)?.[0] ?? this.parent?.getSymbol(key);
    }

    /**
     * Adds a new symbol to the table
     * @param name
     * @param type
     */
    addSymbol(name: Identifier, type: BscType) {
        const key = this.standardizeKey(name);
        const bscSymbol = {
            name: name,
            type: type
        };
        this.symbols.set(key, [bscSymbol]);
    }


    /**
     * Adds all the symbols from another table to this one
     * It will overwrite any existing symbols in this table
     * @param symbolTable
     */
    mergeSymbolTable(symbolTable: SymbolTable) {
        for (let [key, value] of symbolTable.symbols) {
            this.symbols.set(key, value);
        }
    }

    private standardizeKey(name: Identifier | string): string {
        let text = '';
        if ((<Identifier>name).text) {
            text = (<Identifier>name).text;
        } else {
            text = <string>name;
        }
        return text.toLowerCase();
    }
}
