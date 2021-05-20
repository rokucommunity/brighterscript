import { isLazyType } from '../astUtils/reflection';
import type { BrsFile } from '../files/BrsFile';
import type { Scope } from '../Scope';

export interface BscType {
    isAssignableTo(targetType: BscType, context?: TypeContext): boolean;
    isConvertibleTo(targetType: BscType, context?: TypeContext): boolean;
    toString(context?: TypeContext): string;
    toTypeString(context?: TypeContext): string;
    equals(targetType: BscType, context?: TypeContext): boolean;
}


export interface TypeContext {
    file?: BrsFile;
    scope?: Scope;
}


export function getTypeFromContext(type: BscType, context?: TypeContext) {
    if (isLazyType(type)) {
        return type.getTypeFromContext(context);
    }
    return type;
}
