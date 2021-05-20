import { isDynamicType, isObjectType } from '../astUtils/reflection';
import type { BscType, TypeContext } from './BscType';

export class CustomType implements BscType {

    constructor(public name: string) {
    }


    public toString(): string {
        return this.name;
    }

    public toTypeString(): string {
        return 'object';
    }

    public isAssignableTo(targetType: BscType, context?: TypeContext, ancestorTypes?: CustomType[]) {
        if (ancestorTypes?.find(ancestorType => targetType.equals(ancestorType, context))) {
            return true;
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
        return this.toString() === targetType?.toString(context);
    }
}
