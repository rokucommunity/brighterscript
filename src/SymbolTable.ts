import type { Identifier } from './lexer/Token';
import type { BscType } from './types/BscType';

export interface BscSymbol {
    name: Identifier;
    type: BscType;
}

export class SymbolTable {

    private symbols = new Map<string, BscSymbol[]>();

    constructor(
        public parent?: SymbolTable | undefined
    ) { }

    getSymbol(name: Identifier | string): BscSymbol {
        const key = this.getMapKey(name);
        return this.symbols.get(key)?.[0] ?? this.parent?.getSymbol(key);
    }

    addSymbol(name: Identifier, type: BscType) {
        const key = this.getMapKey(name);
        const bscSymbol = {
            name: name,
            type: type
        };
        this.symbols.set(key, [bscSymbol]);
    }

    private getMapKey(name: Identifier | string): string {
        let text = '';
        if ((<Identifier>name).text) {
            text = (<Identifier>name).text;
        } else {
            text = <string>name;
        }
        return text.toLocaleLowerCase();
    }
}
