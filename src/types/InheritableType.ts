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

    getMemberTypes(name: string, flags: SymbolTypeFlags) {
        return super.getMemberTypes(name, flags) ?? [new ReferenceType(name, flags, () => this.memberTable)];
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

    /**
     *  Checks if other type is an ancestor of this
     */
    isTypeAncestor(otherType: BscType) {
        if (!isInheritableType(otherType)) {
            return false;
        }
        // Check if targetType is an ancestor of this
        const ancestors = this.getAncestorTypeList();
        if (ancestors?.find(ancestorType => ancestorType.isEqual(otherType))) {
            return true;
        }
        return false;
    }

    /**
     *  Checks if other type is an descendent of this
     */
    isTypeDescendent(otherType: BscType) {
        if (!isInheritableType(otherType)) {
            return false;
        }
        return otherType.isTypeAncestor(this);
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
