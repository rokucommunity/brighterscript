import type { Position } from '../astUtils';
import { isLazyType } from '../astUtils/reflection';
import type { BrsFile } from '../files/BrsFile';
import type { Scope } from '../Scope';
import type { SymbolTable } from '../SymbolTable';

export interface BscType {
    isAssignableTo(targetType: BscType, context?: TypeContext): boolean;
    isConvertibleTo(targetType: BscType, context?: TypeContext): boolean;
    toString(context?: TypeContext): string;
    toTypeString(context?: TypeContext): string;
    equals(targetType: BscType, context?: TypeContext): boolean;
    memberTable?: SymbolTable;
}

export interface SymbolContainer {
    memberTable: SymbolTable;
}


export interface TypeContext {
    file: BrsFile;
    scope: Scope;
    position?: Position;
}

export function getTypeFromContext(type: BscType, context?: TypeContext) {
    if (isLazyType(type)) {
        return type.getTypeFromContext(context);
    }
    return type;
}
