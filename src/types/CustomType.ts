import { isCustomType, isDynamicType, isObjectType } from '../astUtils/reflection';
import type { SymbolTable } from '../SymbolTable';
import type { BscType, SymbolContainer, TypeContext } from './BscType';
import { checkAssignabilityToInterface } from './BscType';

export class CustomType implements BscType, SymbolContainer {

    constructor(public name: string, public memberTable: SymbolTable = null) {
    }

    public toString(): string {
        return this.name;
    }

    public toTypeString(): string {
        return 'object';
    }

    public isAssignableTo(targetType: BscType, context?: TypeContext) {
        if (isObjectType(targetType)) {
            return true;
        }
        const ancestorTypes = context?.scope?.getAncestorTypeListByContext(this, context);
        if (ancestorTypes?.find(ancestorType => targetType.equals(ancestorType, context))) {
            return true;
        }
        if (this.memberTable && targetType.memberTable) {
            // both have symbol tables, so check if the target is an interface and has all the members of the target
            if (checkAssignabilityToInterface(this, targetType, context)) {
                return true;
            }
        }
        return (
            this.equals(targetType, context) ||
            isObjectType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType, context?: TypeContext) {
        return this.isAssignableTo(targetType, context);
    }

    public equals(targetType: BscType, context?: TypeContext): boolean {
        return isCustomType(targetType) && this.toString() === targetType?.toString();
    }
}
