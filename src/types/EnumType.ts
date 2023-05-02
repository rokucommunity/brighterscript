import { isDynamicType, isEnumMemberType, isEnumType, isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';

export class EnumType extends BscType {
    constructor(
        public name: string
    ) {
        super(name);
    }

    public isAssignableTo(targetType: BscType) {
        if (isUnionType(targetType) && targetType.canBeAssignedFrom(this)) {
            return true;
        }
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

    protected equals(targetType: BscType): boolean {
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

    protected equals(targetType: BscType): boolean {
        return isEnumMemberType(targetType) &&
            targetType?.enumName.toLowerCase() === this.enumName.toLowerCase() &&
            targetType?.memberName.toLowerCase() === this.memberName.toLowerCase();
    }

    getReferenceChain(): string[] {
        return [this.enumName, this.memberName];
    }
}
