import { SymbolTable } from '../SymbolTable';
import { isClassType, isDynamicType, isObjectType } from '../astUtils/reflection';
import type { TypeCompatibilityData } from '../interfaces';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { InheritableType } from './InheritableType';
import type { ReferenceType } from './ReferenceType';
import { isUnionTypeCompatible } from './helpers';

export class ClassType extends InheritableType {

    constructor(public name: string, superClass?: ClassType | ReferenceType) {
        super(name, superClass);
    }

    public readonly kind = BscTypeKind.ClassType;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        if (this.isEqual(targetType, data)) {
            return true;
        } else if (isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType, data)) {
            return true;
        } else if (isClassType(targetType)) {
            return this.isTypeDescendent(targetType);
        }
        return false;
    }

    isEqual(targetType: BscType, data?: TypeCompatibilityData): boolean {
        if (targetType === this) {
            return true;
        }
        return isClassType(targetType) && super.isEqual(targetType, data);
    }

    private builtInMemberTable: SymbolTable;

    getBuiltInMemberTable(): SymbolTable {

        if (!this.parentType) {
            if (this.builtInMemberTable) {
                return this.builtInMemberTable;
            }
            this.builtInMemberTable = new SymbolTable(`${this.__identifier} Built-in Members`);
            this.pushMemberProvider(() => this.builtInMemberTable);
            return this.builtInMemberTable;
        }
    }

    addBuiltInInterfaces() {
        if (!this.hasAddedBuiltInInterfaces) {
            if (this.parentType) {
                this.parentType.addBuiltInInterfaces();
            }
            BuiltInInterfaceAdder.addBuiltInInterfacesToType(this);
        }
        this.hasAddedBuiltInInterfaces = true;
    }
}
