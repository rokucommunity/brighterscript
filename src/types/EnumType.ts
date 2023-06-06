import { isDynamicType, isEnumMemberType, isEnumType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';

export class EnumType extends BscType {
    constructor(
        public name: string
    ) {
        super(name);
    }

    public readonly kind = BscTypeKind.EnumType;

    public isTypeCompatible(targetType: BscType) {
        return (
            isDynamicType(targetType) ||
            this.isEqual(targetType) ||
            (isEnumMemberType(targetType) && targetType?.enumName.toLowerCase() === this.name.toLowerCase())
        );
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        return 'dynamic';
    }

    public isEqual(targetType: BscType): boolean {
        return isEnumType(targetType) && targetType?.name.toLowerCase() === this.name.toLowerCase();
    }
}


export class EnumMemberType extends BscType {
    constructor(
        public enumName: string,
        public memberName: string
    ) {
        super(`${enumName}.${memberName}`);
    }

    public readonly kind = BscTypeKind.EnumMemberType;

    public isAssignableTo(targetType: BscType) {
        return (
            this.isEqual(targetType) ||
            (isEnumType(targetType) &&
                targetType?.name.toLowerCase() === this.enumName.toLowerCase()) ||
            isDynamicType(targetType)
        );
    }

    public isTypeCompatible(targetType: BscType) {
        return (
            this.isEqual(targetType) ||
            isDynamicType(targetType)
        );
    }

    public toString() {
        return this.enumName;
    }

    public toTypeString(): string {
        return 'dynamic';
    }

    public isEqual(targetType: BscType): boolean {
        return isEnumMemberType(targetType) &&
            targetType?.enumName.toLowerCase() === this.enumName.toLowerCase() &&
            targetType?.memberName.toLowerCase() === this.memberName.toLowerCase();
    }
}
