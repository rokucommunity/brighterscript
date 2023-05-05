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

    getMemberTypes(name: string, flags: SymbolTypeFlags) {
        return this.memberTable.getSymbolTypes(name, flags);
    }

    isResolvable(): boolean {
        return true;
    }

    /**
     * Check if this type can be assigned to the target type
     * @param targetType the type that we're trying to assign this type to
     * @deprecated
     */
    isAssignableTo(targetType: BscType): boolean {
        return targetType.isTypeCompatible(this);
    }

    /**
     * Check if a different type can be assigned to this type - eg. does the other type convert into this type?
     * @param _otherType the type to check if it can be used as this type, or can automatically be converted into this type
     */
    isTypeCompatible(_otherType: BscType): boolean {
        throw new Error('Method not implemented.');
    }
    toString(): string {
        throw new Error('Method not implemented.');
    }
    toTypeString(): string {
        throw new Error('Method not implemented.');
    }

    isEqual(targetType: BscType): boolean {
        throw new Error('Method not implemented.');
    }


    checkCompatibilityBasedOnMembers(targetType: BscType, flags: SymbolTypeFlags) {
        let isSuperSet = true;
        const targetSymbols = targetType.memberTable?.getAllSymbols(flags);
        for (const targetSymbol of targetSymbols) {
            const myTypesOfTargetSymbol = this.memberTable.getSymbolTypes(targetSymbol.name, flags);
            isSuperSet = isSuperSet && myTypesOfTargetSymbol && myTypesOfTargetSymbol.length > 0 &&
                myTypesOfTargetSymbol.reduce((acc, myTypeOfTarget) => {
                    return acc && myTypeOfTarget.isTypeCompatible(targetSymbol.type);
                }, true);
            if (!isSuperSet) {
                return false;
            }
        }
        return isSuperSet;
    }
}

