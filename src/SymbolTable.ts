import type { Range } from './astUtils';
import type { BscType } from './types/BscType';
import { DynamicType } from './types/DynamicType';
import { UninitializedType } from './types/UninitializedType';


/**
 * Stores the types associated with variables and functions in the Brighterscript code
 * Can be part of a hierarchy, so lookups can reference parent scopes
 */
export class SymbolTable {

    private symbols = new Map<string, BscSymbol[]>();

    public readonly children: SymbolTable[] = [];

    constructor(
        private parent?: SymbolTable | undefined
    ) { }

    /**
     * Sets the parent table for lookups
     *
     * @param [parent]
     */
    setParent(parent?: SymbolTable) {
        if (this.parent) {
            this.parent.removeChild(this);
        }
        this.parent = parent;
    }

    private removeChild(child: SymbolTable) {
        const index = this.children.indexOf(child);
        if (index > -1) {
            this.children.splice(index, 1);
        }
    }

    /**
     * Checks if the symbol table contains the given symbol by name
     * If the identifier is not in this table, it will check the parent
     *
     * @param name the name to lookup
     * @returns true if this symbol is in the symbol table
     */
    hasSymbol(name: string): boolean {
        const key = name.toLowerCase();
        return !!(this.symbols.has(key) || this.parent?.hasSymbol(key));
    }

    /**
     * Gets the name/type pair for a given named variable or function name
     * If the identifier is not in this table, it will check the parent
     *
     * @param  name the name to lookup
     * @returns An array of BscSymbols - one for each time this symbol had a type implicitly defined
     */
    getSymbol(name: string): BscSymbol[] {
        const key = name.toLowerCase();
        return this.symbols.get(key) ?? this.parent?.getSymbol(key);
    }

    /**
     * Adds a new symbol to the table
     * @param name
     * @param  type
     */
    addSymbol(name: string, range: Range, type: BscType) {
        const key = name.toLowerCase();
        if (!this.symbols.has(key)) {
            this.symbols.set(key, []);
        }
        this.symbols.get(key).push({
            name: name,
            range: range,
            type: type
        });
    }

    /**
     * Gets the type for a symbol
     * @param name the name of the symbol to get the type for
     * @returns The type, if found. If the type has ever changed, return DynamicType. If not found, returns UninitializedType
     */
    getSymbolType(name: string): BscType {
        const key = name.toLowerCase();
        const symbols = this.symbols.get(key);
        if (symbols?.length > 1) {
            //Check if each time it was set, it was set to the same type
            // TODO handle union types
            let sameImpliedType = true;
            let impliedType = symbols[0].type;
            for (const symbol of symbols) {
                sameImpliedType = (impliedType.toString() === symbol.type.toString());
                if (!sameImpliedType) {
                    break;
                }
            }
            return sameImpliedType ? impliedType : new DynamicType();
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
        for (let [, value] of symbolTable.symbols) {
            for (const symbol of value) {
                this.addSymbol(
                    symbol.name,
                    symbol.range,
                    symbol.type
                );
            }
        }
    }
}


export interface BscSymbol {
    name: string;
    range: Range;
    type: BscType;
}
