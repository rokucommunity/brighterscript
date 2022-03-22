import type { Position } from 'vscode-languageserver';
import { isLazyType, isInterfaceType } from '../astUtils/reflection';
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

export function checkAssignabilityToInterface(sourceType: BscType, targetType: BscType, context?: TypeContext) {
    if (!sourceType.memberTable || !targetType.memberTable || !isInterfaceType(targetType)) {
        return false;
    }
    let isSuperSet = true;
    const targetSymbols = targetType.memberTable?.getAllSymbols();
    for (const targetSymbol of targetSymbols) {
        // TODO TYPES: this ignores union types

        const mySymbolsWithName = sourceType.memberTable.getSymbol(targetSymbol.name);
        isSuperSet = isSuperSet && mySymbolsWithName && mySymbolsWithName.length > 0 && mySymbolsWithName[0].type.isAssignableTo(targetSymbol.type, context);
    }
    return isSuperSet;
}
