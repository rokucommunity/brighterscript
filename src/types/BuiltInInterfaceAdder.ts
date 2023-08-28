import type { BRSInterfaceData } from '../roku-types';
import { components, interfaces } from '../roku-types';
import { Cache } from '../Cache';
import type { TypedFunctionType } from './TypedFunctionType';
import type { SymbolTable } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTable';
import type { BscType } from './BscType';
import { isArrayType, isBooleanType, isCallableType, isClassType, isDoubleType, isEnumMemberType, isEnumType, isFloatType, isIntegerType, isInvalidType, isLongIntegerType, isStringType } from '../astUtils/reflection';
import type { ExtraSymbolData } from '../interfaces';


interface AddSymbolCallData {
    name: string;
    data: ExtraSymbolData;
    type: BscType;
    flags: SymbolTypeFlag;
}


// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class BuiltInInterfaceAdder {

    static readonly primitiveTypeInstanceCache = new Cache<string, BscType>();

    static typedFunctionFactory: (type: BscType) => TypedFunctionType;

    static symbolsToAddCache = new Cache<BscType, AddSymbolCallData[]>();

    static addBuiltInInterfacesToType(thisType: BscType) {

        const existingAddSymbolCallParams = this.symbolsToAddCache.get(thisType);
        if (existingAddSymbolCallParams) {
            this.addSymbolsToTable(thisType.getBuiltInMemberTable(), existingAddSymbolCallParams);
            return;
        }
        const componentName = this.getMatchingRokuComponent(thisType);
        if (!componentName) {
            // No component matches the given type
            return;
        }
        const memberTable = thisType.getBuiltInMemberTable();
        if (!memberTable) {
            // no memberTable to add to
            // this could be because it's a class that has a parent
            // the original ancestor should get the built ins
            return;
        }
        const builtInComponent = components[componentName.toLowerCase()];
        if (!builtInComponent) {
            throw new Error(`Unknown Roku component '${componentName}'`);
        }
        if (!this.typedFunctionFactory) {
            throw new Error(`Unable to build typed functions - no typed function factory`);
        }
        const callsForAddSymbol = [] as AddSymbolCallData[];
        for (const iface of builtInComponent.interfaces) {
            for (const method of (interfaces[iface.name.toLowerCase()] as BRSInterfaceData).methods) {
                const returnType = this.getPrimitiveType(method.returnType);
                const methodFuncType = this.typedFunctionFactory(returnType);
                methodFuncType.name = method.name;
                for (const param of method.params) {
                    const paramType = this.getPrimitiveType(param.type);
                    methodFuncType.addParameter(param.name, paramType, !param.isRequired);
                }
                callsForAddSymbol.push({
                    name: method.name,
                    data: { description: method.description, completionPriority: 1 },
                    type: methodFuncType,
                    flags: SymbolTypeFlag.runtime
                });
            }
        }
        this.symbolsToAddCache.set(thisType, callsForAddSymbol);
        this.addSymbolsToTable(memberTable, callsForAddSymbol);
    }

    private static addSymbolsToTable(memberTable: SymbolTable, callParams: AddSymbolCallData[]) {
        if (!memberTable) {
            return;
        }
        for (const callParam of callParams) {
            memberTable.addSymbol(callParam.name, callParam.data, callParam.type, callParam.flags);

        }
    }

    private static getPrimitiveType(typeName: string): BscType {
        const returnType = this.primitiveTypeInstanceCache.get(typeName.toLowerCase());
        if (!returnType) {
            throw new Error(`Unable to find type instance '${typeName}'`);
        }
        return returnType;
    }

    static getMatchingRokuComponent(theType: BscType) {
        if (isStringType(theType)) {
            return 'roString';
        } else if (isIntegerType(theType)) {
            return 'roInt';
        } else if (isBooleanType(theType)) {
            return 'roBoolean';
        } else if (isFloatType(theType)) {
            return 'roFloat';
        } else if (isDoubleType(theType)) {
            return 'roDouble';
        } else if (isLongIntegerType(theType)) {
            return 'roLongInteger';
        } else if (isInvalidType(theType)) {
            return 'roInvalid';
        } else if (isCallableType(theType)) {
            return 'roFunction';
        } else if (isClassType(theType)) {
            return 'roAssociativeArray';
        } else if (isArrayType(theType)) {
            return 'roArray';
        } else if (isEnumMemberType(theType) || isEnumType(theType)) {
            return this.getMatchingRokuComponent(theType.underlyingType);
        }
    }

}
