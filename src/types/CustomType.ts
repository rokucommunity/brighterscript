import { isDynamicType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class CustomType implements BscType {

    constructor(public name: string) {
    }


    public toString(): string {
        return this.name;
    }

    public toTypeString(): string {
        return 'object';
    }

    public isAssignableTo(targetType: BscType, ancestorTypes?: CustomType[]) {
        if (ancestorTypes?.find(ancestorType => targetType.equals(ancestorType))) {
            return true;
        }
        return (
            this.equals(targetType) ||
            isObjectType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public equals(targetType: BscType): boolean {
        return this.toString() === targetType.toString();
    }
}
