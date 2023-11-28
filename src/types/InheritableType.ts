import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { isInheritableType, isReferenceType } from '../astUtils/reflection';
import { SymbolTypeFlag } from '../SymbolTable';
import { BscType } from './BscType';
import type { ReferenceType } from './ReferenceType';

export abstract class InheritableType extends BscType {

    constructor(public name: string, public readonly parentType?: InheritableType | ReferenceType) {
        super(name);
        if (parentType) {
            this.memberTable.pushParentProvider(() => this.parentType.memberTable);
        }
    }

    getMemberType(memberName: string, options: GetTypeOptions) {
        return super.getMemberType(memberName, { ...options, fullName: memberName, tableProvider: () => this.memberTable });
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        return 'dynamic';
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
        const flags = 3 as SymbolTypeFlag; //SymbolTypeFlags.runtime | SymbolTypeFlags.typetime;
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

    isEqual(targetType: BscType, data: TypeCompatibilityData = {}): boolean {
        if (this === targetType) {
            return true;
        }
        if (isReferenceType(targetType)) {
            const lowerTargetName = (targetType.memberKey ?? targetType.fullName).toLowerCase();
            const myLowerName = this.name.toLowerCase();

            if (myLowerName === lowerTargetName) {
                return true;
            }
            //check non-namespaced version
            if (myLowerName.split('.').reverse()[0] === lowerTargetName) {
                return true;
            }
        }
        if (!isInheritableType(targetType)) {
            return false;
        }
        if (!targetType) {
            return false;
        }
        if (this === targetType) {
            return true;
        }
        if (this.isAncestorUnresolvedReferenceType() || targetType.isAncestorUnresolvedReferenceType()) {
            return this.name.toLowerCase() === targetType.name?.toLowerCase() &&
                this.isParentTypeEqual(targetType, data);
        }
        return this.name.toLowerCase() === targetType.name?.toLowerCase() &&
            this.isParentTypeEqual(targetType, data) &&
            this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data) &&
            targetType.checkCompatibilityBasedOnMembers(this, SymbolTypeFlag.runtime, data);
    }

    protected isParentTypeEqual(targetType: BscType, data?: TypeCompatibilityData): boolean {
        if (isInheritableType(targetType)) {
            const targetParent = targetType.parentType;
            if (this.parentType && !targetParent) {
                return false;
            } else if (!this.parentType && !targetParent) {
                return true;
            } else if (!this.parentType && targetParent) {
                return false;
            }
            if (isReferenceType(targetParent) || isReferenceType(this.parentType)) {
                let thisParentName = isReferenceType(this.parentType) ? this.parentType.memberKey ?? this.parentType.fullName : this.parentType.name;
                let targetParentName = isReferenceType(targetParent) ? targetParent.memberKey ?? targetParent.fullName : targetParent.name;
                return thisParentName.toLowerCase() === targetParentName.toLowerCase();
            }
            return this.parentType.isEqual(targetParent, data);
        }
        return false;
    }

    protected isAncestorUnresolvedReferenceType() {
        let p = this as InheritableType;
        while (p) {
            if (isReferenceType(p) && !p.isResolvable()) {
                return true;
            }
            p = (p as any).parentType;

        }
        return false;
    }
}

