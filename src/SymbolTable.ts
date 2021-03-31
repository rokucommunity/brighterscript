import type { Identifier } from './lexer/Token';
import type { BscType } from './types/BscType';
import { DynamicType } from './types/DynamicType';
import { UninitializedType } from './types/UninitializedType';

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
     * @param {string)} name the name to lookup
     * @returns {BscSymbol}
     */
    getSymbol(name: string): BscSymbol[] {
        const key = name.toLowerCase();
        return this.symbols.get(key) ?? this.parent?.getSymbol(key);
    }

    /**
     * Adds a new symbol to the table
     * @param {Identifier} name
     * @param {BscType} type
     */
    addSymbol(name: Identifier, type: BscType) {
        const key = name.text.toLowerCase();
        if (!this.symbols.has(key)) {
            this.symbols.set(key, []);
        }
        this.symbols.get(key).push({
            name: name,
            type: type
        });
    }

    /**
     * Gets the type for a symbol
     * @param {string} name the name of the symbol to get the type for
     * @returns The type, if found. If the type has ever changed, return DynamicType. If not found, returns UninitializedType
     */
    getSymbolType(name: string): BscType {
        const key = name.toLowerCase();
        const symbols = this.symbols.get(key);
        if (symbols?.length > 1) {
            //Check if each time it was set, it was set to the same type
            // TODO handle union types
            let sameType = true;
            const firstType = symbols[0].type.toString();
            for (const symbol of symbols) {
                sameType = firstType === symbol.type.toString();
                if (!sameType) {
                    break;
                }
            }
            return sameType ? symbols[0].type : new DynamicType();
        } else if (symbols?.length === 1) {
            return symbols[0].type;
        }

        return this.parent?.getSymbolType(name) ?? new UninitializedType();
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
}
