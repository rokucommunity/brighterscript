import type { Position, Range } from 'vscode-languageserver';
import type { BscType, TypeContext } from './types/BscType';
import { getTypeFromContext } from './types/BscType';
import { DynamicType } from './types/DynamicType';

/**
 * Stores the types associated with variables and functions in the Brighterscript code
 * Can be part of a hierarchy, so lookups can reference parent scopes
 */
export class SymbolTable {
    constructor(
        parent?: SymbolTable | undefined,
        public identifier: string = ''
    ) {
        this.pushParent(parent);
    }

    /**
     * The map of symbols declared directly in this SymbolTable (excludes parent SymbolTable).
     * Indexed by lower symbol name
     */
    private symbolMap = new Map<string, BscSymbol[]>();

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

    public get parent() {
        return this.parentStack[0];
    }

    /**
     * Sets the parent table for lookups. There can only be one parent at a time, but sometimes you
     * want to temporarily change the parent, and then restore it later. This allows that.
     *
     * @param [parent]
     */
    private parentStack: SymbolTable[] = [];

    public pushParent(parent?: SymbolTable) {
        if (parent) {
            this.parentStack.unshift(parent);
        }
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
     * Gets the type for a symbol
     * @param name the name of the symbol to get the type for
     * @param searchParent should we look to our parent if we don't have the symbol?
     * @param context the context for where this type was referenced - used ONLY for lazy types
     * @returns The type, if found. If the type has ever changed, return DynamicType. If not found, returns UninitializedType
     */
    getSymbolType(name: string, searchParent = true, context?: TypeContext): BscType {
        const key = name.toLowerCase();
        const symbols = this.symbolMap.get(key);
        if (symbols?.length > 1) {
            //Check if each time it was set, it was set to the same type
            // TODO TYPES handle union types
            let sameInferredType = true;
            let inferredType: BscType;
            for (const symbol of symbols) {
                if ((context?.position && isPositionBefore(symbol.range?.end, context.position)) || !context?.position) {
                    // if we're looking at context with a position, only look at types that were set before
                    const existingType = getTypeFromContext(symbol.type, context);
                    // if the type is not known yet, imply that the first assignment is the type
                    inferredType = inferredType ?? existingType;

                    // TODO TYPES ... maybe this should look as 'convertibility' to infer a type
                    // EG.:
                    // value = 1
                    // value = 3.4
                    // print value ' hover here would say "dynamic", but it's been treated like a float
                    //
                    // This also impacts Enums, for example, as literal members are different types than a value that is generically a value of the type of the Enum:
                    //
                    // function getDataType(defaultValue as DataEnum) as DataEnum
                    //    returnVal = defaultValue
                    //    if someCondition
                    //       returnVal = DataEnum.Other
                    //    end if
                    //    return returnVal ' hover here would say dynamic, but returnVal was always some kind of "DataEnum"
                    // end function
                    sameInferredType = (inferredType?.equals(existingType, context));
                }
                if (!sameInferredType) {
                    break;
                }
            }
            return sameInferredType ? inferredType : new DynamicType();
        } else if (symbols?.length === 1) {
            return getTypeFromContext(symbols[0].type, context);
        }
        if (searchParent) {
            const parentContext = context ? { file: context?.file, scope: context?.scope } : undefined;
            return this.parent?.getSymbolType(name, true, parentContext) ?? undefined;
        } else {
            return undefined;
        }
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

    /**
     * Serialize this SymbolTable to JSON (useful for debugging reasons)
     */
    private toJSON() {
        return {
            identifier: this.identifier,
            parent: this.parent?.toJSON(),
            parentStack: this.parentStack.map(p => p?.toJSON()),
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
}

function isPositionBefore(pos1: Position, pos2: Position): boolean {
    if (pos1?.line < pos2?.line) {
        return true;
    }
    return false;
}
