import { isDynamicType, isFunctionType } from '../astUtils/reflection';
import type { BscType, TypeContext } from './BscType';

export class FunctionType implements BscType {

    isAssignableTo(targetType: BscType, context?: TypeContext): boolean {
        //since this is a basic function type, we're only assignable to other basic function types
        if (isFunctionType(targetType)) {
            return true;
        } else if (isDynamicType(targetType)) {
            return true;
        } else {
            return false;
        }
    }

    isConvertibleTo(targetType: BscType, context?: TypeContext): boolean {
        return this.isAssignableTo(targetType);
    }

    toString(context?: TypeContext): string {
        return 'Function';
    }

    toTypeString(context?: TypeContext): string {
        return 'Function';
    }

    public equals(targetType: BscType, context?: TypeContext): boolean {
        return isFunctionType(targetType);
    }
}
