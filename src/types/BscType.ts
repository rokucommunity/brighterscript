import type { SymbolTableProvider } from '../SymbolTable';
import { SymbolTypeFlags } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import type { Range } from 'vscode-languageserver';

export abstract class BscType {

    protected symbolTable: SymbolTable;
    protected __identifier: string;

    constructor(name = '') {
        this.__identifier = `${this.constructor.name}${name ? ': ' + name : ''}`;
        this.symbolTable = new SymbolTable(this.__identifier);
    }

    pushMemberProvider(provider: SymbolTableProvider) {
        this.symbolTable.pushParentProvider(provider);
    }

    popMemberProvider() {
        this.symbolTable.popParentProvider();
    }

    addMember(name: string, range: Range, type: BscType, flags: SymbolTypeFlags) {
        this.symbolTable.addSymbol(name, range, type, flags);
    }

    getMemberType(name: string) {
        // eslint-disable-next-line no-bitwise
        return this.symbolTable.getSymbol(name, SymbolTypeFlags.runtime | SymbolTypeFlags.typetime)?.[0].type;
    }

    isAssignableTo(_targetType: BscType): boolean {
        throw new Error('Method not implemented.');
    }
    isConvertibleTo(_targetType: BscType): boolean {
        throw new Error('Method not implemented.');
    }
    toString(): string {
        throw new Error('Method not implemented.');
    }
    toTypeString(): string {
        throw new Error('Method not implemented.');
    }
}
