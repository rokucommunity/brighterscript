import { isDynamicType, isObjectType } from '../astUtils/reflection';
import type { SymbolTable } from '../SymbolTable';
import type { BscType, SymbolContainer } from './BscType';

export class ObjectType implements BscType, SymbolContainer {
    constructor(
        public typeText?: string,
        public memberTable: SymbolTable = null
    ) {
    }

    public isAssignableTo(targetType: BscType) {
        return (
            isObjectType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return this.typeText ?? 'object';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isObjectType(targetType) && this.isAssignableTo(targetType);
    }
}
