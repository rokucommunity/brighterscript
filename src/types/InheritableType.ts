import type { SymbolTypeFlags } from '../SymbolTable';
import { isClassType, isInterfaceType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';

export abstract class InheritableType extends BscType {

    constructor(public name: string, public readonly parentType?: InheritableType | ReferenceType) {
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

    public equals(targetType: BscType): boolean {
        return isClassType(targetType) && this.toString() === targetType?.toString();
    }

    protected getAncestorTypeList(): InheritableType[] {
        const ancestors = [];
        let currentParentType = this.parentType;
        while (currentParentType) {
            if (isClassType(currentParentType) || isInterfaceType(currentParentType)) {
                ancestors.push(currentParentType);
                currentParentType = currentParentType.parentType;
            } else {
                break;
            }
        }
        return ancestors;
    }

    checkAssignabilityToInterface(targetType: BscType, flags: SymbolTypeFlags) {
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
}
