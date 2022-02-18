import { isDynamicType, isGenericFunctionType } from '../astUtils/reflection';

import type { BscType, TypeContext } from './BscType';


export class GenericFunctionType implements BscType {


    public isAssignableTo(targetType: BscType, context?: TypeContext) {
        if (isGenericFunctionType(targetType)) {

        } else if (isDynamicType(targetType)) {
            return true;
        } else {
            return false;
        }
    }

    public isConvertibleTo(targetType: BscType, context?: TypeContext) {
        return this.isAssignableTo(targetType, context);
    }

    public toString(context?: TypeContext) {
        return `function () as dynamic`;
    }

    public toTypeString(): string {
        return 'Function';
    }

    public equals(targetType: BscType, context?: TypeContext): boolean {
        return (isGenericFunctionType(targetType));
    }
}
