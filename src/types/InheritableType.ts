import { SymbolTypeFlags } from '../SymbolTable';
import { isClassType, isInterfaceType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';

export abstract class InheritableType extends BscType {

    constructor(public name: string, public readonly parentType?: BscType) {
        super(name);
        if (parentType) {
            this.memberTable.pushParentProvider(() => this.parentType.memberTable);
        }
    }

    getMemberType(name: string, flags: SymbolTypeFlags) {
        return super.getMemberType(name, flags) ?? new ReferenceType(name, flags, () => this.memberTable);
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        return 'dynamic';
    }

    isResolvable(): boolean {
        return this.parentType ? this.parentType.isResolvable() : true;
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    equals(targetType: BscType) {
        return this === targetType;
    }

    protected getAncestorTypeList(): InheritableType[] {
        const ancestors = [];
        let currentParentType = this.parentType;
        while (currentParentType) {
            if (isInheritableType(currentParentType)) {
                ancestors.push(currentParentType);
                currentParentType = currentParentType.parentType;
            } else {
                break;
            }
        }
        return ancestors;
    }

    protected checkAssignabilityToInterface(targetType: BscType, flags: SymbolTypeFlags) {
        if (!isInterfaceType(targetType)) {
            return false;
        }
        let isSuperSet = true;
        const targetSymbols = targetType.memberTable?.getAllSymbols(flags);
        for (const targetSymbol of targetSymbols) {
            // TODO TYPES: this ignores union types

            const mySymbolsWithName = this.memberTable.getSymbol(targetSymbol.name, flags);
            isSuperSet = isSuperSet && mySymbolsWithName && mySymbolsWithName.length > 0 && mySymbolsWithName[0].type.isAssignableTo(targetSymbol.type);
        }
        return isSuperSet;
    }


    /**
     * Gets a string representation of the Interface that looks like javascript
     * Useful for debugging
     */
    private toJSString() {
        // eslint-disable-next-line no-bitwise
        const flags = SymbolTypeFlags.runtime | SymbolTypeFlags.typetime;
        let result = '{';
        const memberSymbols = (this.memberTable?.getAllSymbols(flags) || []).sort((a, b) => a.name.localeCompare(b.name));
        for (const symbol of memberSymbols) {
            let symbolTypeString = symbol.type.toString();
            if (isInheritableType(symbol.type)) {
                symbolTypeString = symbol.type.toJSString();
            }
            result += ' ' + symbol.name + ': ' + symbolTypeString + ';';
        }
        if (memberSymbols.length > 0) {
            result += ' ';
        }
        return result + '}';
    }
}

export function isInheritableType(target): target is InheritableType {
    return isClassType(target) || isInterfaceType(target);
}
