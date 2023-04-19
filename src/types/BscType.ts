import type { SymbolTableProvider } from '../SymbolTable';
import { SymbolTypeFlags } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import type { Range } from 'vscode-languageserver';

export abstract class BscType {

    protected memberTable: SymbolTable;
    protected __identifier: string;

    constructor(name = '') {
        this.__identifier = `${this.constructor.name}${name ? ': ' + name : ''}`;
        this.memberTable = new SymbolTable(this.__identifier);
    }

    pushMemberProvider(provider: SymbolTableProvider) {
        this.memberTable.pushParentProvider(provider);
    }

    popMemberProvider() {
        this.memberTable.popParentProvider();
    }

    addMember(name: string, range: Range, type: BscType, flags: SymbolTypeFlags) {
        this.memberTable.addSymbol(name, range, type, flags);
    }

    getMemberType(name: string) {
        // eslint-disable-next-line no-bitwise
        return this.memberTable.getSymbol(name, SymbolTypeFlags.runtime | SymbolTypeFlags.typetime)?.[0]?.type;
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
