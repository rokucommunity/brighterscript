import type { BRSInterfaceData, SGNodeData } from '../roku-types';
import { components, events, interfaces, nodes } from '../roku-types';
import { Cache } from '../Cache';
import type { TypedFunctionType } from './TypedFunctionType';
import type { SymbolTable } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTable';
import type { BscType } from './BscType';
import { isArrayType, isBooleanType, isCallableType, isClassType, isComponentType, isDoubleType, isEnumMemberType, isFloatType, isIntegerType, isInterfaceType, isInvalidType, isLongIntegerType, isStringType } from '../astUtils/reflection';
import type { ComponentType } from './ComponentType';
import util from '../util';


export interface BuiltInInterfaceOverride {
    type?: BscType;
    parameterTypes?: BscType[];
    returnType?: BscType;
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class BuiltInInterfaceAdder {

    static readonly primitiveTypeInstanceCache = new Cache<string, BscType>();

    static typedFunctionFactory: (type: BscType) => TypedFunctionType;

    static getLookupTable: () => SymbolTable;

    static addBuiltInInterfacesToType(thisType: BscType, overrides?: Map<string, BuiltInInterfaceOverride>) {
        const memberTable = thisType.getBuiltInMemberTable();
        if (!memberTable) {
            // no memberTable to add to
            // this could be because it's a class that has a parent
            // the original ancestor should get the built ins
            return;
        }
        const builtInComponent = this.getMatchingRokuComponent(thisType);
        if (!builtInComponent) {
            //throw new Error(`Unknown Roku component '${componentName}'`);
            return;
        }
        if (!this.typedFunctionFactory) {
            throw new Error(`Unable to build typed functions - no typed function factory`);
        }
        const interfacesToLoop = builtInComponent.interfaces ?? [builtInComponent];

        for (const iface of interfacesToLoop) {
            const lowerIfaceName = iface.name.toLowerCase();
            const ifaceData = (interfaces[lowerIfaceName] ?? events[lowerIfaceName]) as BRSInterfaceData;
            for (const method of ifaceData.methods ?? []) {
                const override = overrides?.get(method.name.toLowerCase());
                const returnType = override?.returnType ?? this.getPrimitiveType(method.returnType);
                const methodFuncType = this.typedFunctionFactory(returnType);
                methodFuncType.name = method.name;
                // eslint-disable-next-line @typescript-eslint/prefer-for-of
                for (let i = 0; i < method.params.length; i++) {
                    const param = method.params[i];
                    const paramType = override?.parameterTypes?.[i] ?? this.getPrimitiveType(param.type);
                    methodFuncType.addParameter(param.name, paramType, !param.isRequired);
                }
                memberTable.addSymbol(method.name, { description: method.description, completionPriority: 1 }, methodFuncType, SymbolTypeFlag.runtime);
            }
            for (const property of ifaceData.properties ?? []) {
                const override = overrides?.get(property.name.toLowerCase());
                memberTable.addSymbol(property.name, { description: property.description, completionPriority: 1 }, override?.type ?? this.getPrimitiveType(property.type), SymbolTypeFlag.runtime);
            }
        }
    }

    private static getPrimitiveType(typeName: string): BscType {
        const returnType = this.primitiveTypeInstanceCache.get(typeName.toLowerCase());
        if (!returnType) {
            if (!this.getLookupTable) {
                throw new Error(`Unable to find type instance '${typeName}'`);
            }
            return this.getLookupTable()?.getSymbolType(typeName, { flags: SymbolTypeFlag.typetime });
        }

        return returnType;
    }

    static getMatchingRokuComponentName(theType: BscType) {
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
        } else if (isEnumMemberType(theType)) {
            return this.getMatchingRokuComponentName(theType.underlyingType);
        } else if (isInterfaceType(theType)) {
            return theType.name;
        } else if (isComponentType(theType)) {
            return 'roSGNode';
        }
    }

    static getMatchingRokuComponent(theType: BscType) {
        const componentName = this.getMatchingRokuComponentName(theType);
        if (!componentName) {
            // No component matches the given type
            return;
        }
        const lowerComponentName = componentName.toLowerCase();
        return components[lowerComponentName] ?? interfaces[lowerComponentName] ?? events[lowerComponentName];
    }

    static addBuiltInFieldsToNodeType(thisType: ComponentType) {
        const nodeName = thisType.name;
        const memberTable = thisType.memberTable;
        if (!memberTable) {
            // no memberTable to add to
            return;
        }
        const builtInNode = nodes[nodeName.toLowerCase()] as SGNodeData;
        if (!builtInNode) {
            return;
        }
        if (!this.typedFunctionFactory) {
            throw new Error(`Unable to build typed functions - no typed function factory`);
        }
        const lookupTable = this.getLookupTable();
        for (const field of builtInNode.fields) {
            memberTable.addSymbol(field.name, { description: field.description, completionPriority: 1 }, util.getNodeFieldType(field.type, lookupTable), SymbolTypeFlag.runtime);
        }
    }

}
