import { isDynamicType, isEnumMemberType, isEnumType } from '../astUtils/reflection';
import type { BscType, SymbolContainer } from './BscType';
import type { SymbolTable } from '../SymbolTable';

export class EnumType implements BscType, SymbolContainer {
    constructor(
        public name: string, public memberTable: SymbolTable = null
    ) { }

    public isAssignableTo(targetType: BscType) {
        return (
            this.equals(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        return 'dynamic';
    }

    public equals(targetType: BscType): boolean {
        return isEnumType(targetType) && targetType?.name.toLowerCase() === this.name.toLowerCase();
    }
}


export class EnumMemberType implements BscType {
    constructor(
        public enumName: string, public memberName: string
    ) { }

    public isAssignableTo(targetType: BscType) {
        return (
            this.equals(targetType) ||
            (isEnumType(targetType) &&
                targetType?.name.toLowerCase() === this.enumName.toLowerCase()) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return this.enumName;
    }

    public toTypeString(): string {
        return 'dynamic';
    }

    public equals(targetType: BscType): boolean {
        return isEnumMemberType(targetType) &&
            targetType?.enumName.toLowerCase() === this.enumName.toLowerCase() &&
            targetType?.memberName.toLowerCase() === this.memberName.toLowerCase();
    }
}
