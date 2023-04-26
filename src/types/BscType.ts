import type { SymbolTableProvider, SymbolTypeFlags } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import type { Range } from 'vscode-languageserver';

export abstract class BscType {

    public readonly memberTable: SymbolTable;
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

    getMemberType(name: string, flags: SymbolTypeFlags) {
        return this.memberTable.getSymbol(name, flags)?.[0]?.type;
    }

    isResolvable(): boolean {
        return true;
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

    equals(targetType: BscType): boolean {
        return targetType.constructor.name === this.constructor.name;
    }
}
