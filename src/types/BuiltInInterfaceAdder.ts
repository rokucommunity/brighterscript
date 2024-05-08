import type { BRSInterfaceData, BRSInterfaceMethodData, SGNodeData } from '../roku-types';
import { components, events, interfaces, nodes } from '../roku-types';
import { Cache } from '../Cache';
import type { TypedFunctionType } from './TypedFunctionType';
import type { SymbolTable } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import type { BscType } from './BscType';
import { isArrayType, isAssociativeArrayType, isBooleanType, isCallableType, isComponentType, isDoubleType, isEnumMemberType, isFloatType, isIntegerType, isInterfaceType, isInvalidType, isLongIntegerType, isStringType } from '../astUtils/reflection';
import type { ComponentType } from './ComponentType';
import util from '../util';
import type { UnionType } from './UnionType';


export interface BuiltInInterfaceOverride {
    type?: BscType;
    parameterTypes?: BscType[];
    returnType?: BscType;
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class BuiltInInterfaceAdder {

    static readonly primitiveTypeInstanceCache = new Cache<string, BscType>();

    static typedFunctionFactory: (type: BscType) => TypedFunctionType;
    static unionTypeFactory: (types: BscType[]) => UnionType;

    static getLookupTable: () => SymbolTable;

    static addBuiltInInterfacesToType(thisType: BscType, overrides?: Map<string, BuiltInInterfaceOverride>) {
        const builtInMemberTable = thisType.getBuiltInMemberTable();
        if (!builtInMemberTable) {
            // no memberTable to add to
            // this could be because it's a class that has a parent
            // the original ancestor should get the built ins
            return;
        }
        //const realMemberTable = thisType.getMemberTable();
        //const checkForExistingMembers = realMemberTable && realMemberTable !== builtInMemberTable;
        const builtInComponent = this.getMatchingRokuComponent(thisType);
        if (!builtInComponent) {
            // TODO: Perhaps have error here, but docs have some references to unknown types
            //throw new Error(`Unknown Roku component '${this.getMatchingRokuComponentName(thisType)}' for type '${thisType.toString()}'`);
            return;
        }
        if (!this.typedFunctionFactory) {
            throw new Error(`Unable to build typed functions - no typed function factory`);
        }
        const interfacesToLoop = builtInComponent.interfaces ?? [builtInComponent];

        for (const iface of interfacesToLoop) {
            const lowerIfaceName = iface.name.toLowerCase();
            const ifaceData = (interfaces[lowerIfaceName] ?? events[lowerIfaceName]) as BRSInterfaceData;

            if (builtInComponent.interfaces) {
                // this type has interfaces - add them directly as members
                const ifaceType = this.getLookupTable()?.getSymbolType(iface.name, { flags: SymbolTypeFlag.typetime });
                if (ifaceType) {
                    builtInMemberTable.addSymbol(iface.name, { completionPriority: 1 }, ifaceType, SymbolTypeFlag.runtime);
                }
            }

            for (const method of ifaceData.methods ?? []) {
                if (ifaceData.name.toLowerCase() === 'ifintops' && method.name.toLowerCase() === 'tostr') {
                    // handle special case - this messed up the .toStr() method on integers
                    continue;
                }
                const methodFuncType = this.buildMethodFromDocData(method, overrides, thisType);
                builtInMemberTable.addSymbol(method.name, { description: method.description, completionPriority: 1 }, methodFuncType, SymbolTypeFlag.runtime);
            }
            for (const property of ifaceData.properties ?? []) {
                const override = overrides?.get(property.name.toLowerCase());
                builtInMemberTable.addSymbol(property.name, { description: property.description, completionPriority: 1 }, override?.type ?? this.getPrimitiveType(property.type) ?? this.getPrimitiveType('dynamic'), SymbolTypeFlag.runtime);
            }
        }
    }

    private static buildMethodFromDocData(method: BRSInterfaceMethodData, overrides?: Map<string, BuiltInInterfaceOverride>, thisType?: BscType): TypedFunctionType {
        const override = overrides?.get(method.name.toLowerCase());
        let returnType = override?.returnType ?? this.getPrimitiveType(method.returnType);
        if (!returnType && method.returnType.toLowerCase() === (thisType as any)?.name?.toLowerCase()) {
            returnType = thisType;
        }
        const methodFuncType = this.typedFunctionFactory(returnType);
        methodFuncType.name = method.name;
        methodFuncType.isVariadic = method.isVariadic ?? false;
        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < method.params.length; i++) {
            const param = method.params[i];
            let paramType = override?.parameterTypes?.[i] ?? this.getPrimitiveType(param.type);
            if (!paramType && param.type.toLowerCase() === (thisType as any)?.name?.toLowerCase()) {
                paramType = thisType;
            }
            paramType ??= this.primitiveTypeInstanceCache.get('dynamic');
            methodFuncType.addParameter(param.name, paramType, !param.isRequired);
        }
        return methodFuncType;
    }

    private static getPrimitiveType(typeName: string): BscType {
        if (typeName.includes(' or ')) {
            if (!this.unionTypeFactory) {
                throw new Error(`Unable to build union types - no union type factory`);
            }
            // union types!
            const unionOfTypeNames = typeName.split(' or ');
            return this.unionTypeFactory(unionOfTypeNames.map(name => this.getPrimitiveType(name)));
        }
        const returnType = this.primitiveTypeInstanceCache.get(typeName.toLowerCase());
        if (!returnType) {
            if (!this.getLookupTable) {
                throw new Error(`Unable to find type instance '${typeName}'`);
            }
            return this.getLookupTable()?.getSymbolType(typeName, { flags: SymbolTypeFlag.typetime, fullName: typeName, tableProvider: this.getLookupTable });
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
        } else if (isAssociativeArrayType(theType)) {
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
        for (const method of builtInNode.methods ?? []) {
            const methodFuncType = this.buildMethodFromDocData(method, null, thisType);
            memberTable.addSymbol(method.name, { description: method.description, completionPriority: 1 }, methodFuncType, SymbolTypeFlag.runtime);
        }
    }

}
