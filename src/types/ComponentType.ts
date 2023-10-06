import type { GetSymbolTypeOptions, SymbolTypeFlag } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import { isComponentType, isDynamicType, isObjectType } from '../astUtils/reflection';
import type { ExtraSymbolData, TypeCompatibilityData } from '../interfaces';
import type { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { InheritableType } from './InheritableType';
import { isUnionTypeCompatible } from './helpers';
import util from '../util';
import { TypedFunctionType } from './TypedFunctionType';
import { DynamicType } from './DynamicType';
import { StringType } from './StringType';

export class ComponentType extends InheritableType {

    constructor(public name: string, superComponent?: ComponentType) {
        super(name, superComponent);
        this.callFuncMemberTable = new SymbolTable(`${this.name}: CallFunc`, () => this.parentComponent?.callFuncMemberTable);
    }

    public readonly kind = BscTypeKind.ComponentType;

    public get parentComponent() {
        return this.parentType as ComponentType;
    }

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        if (this.isEqual(targetType)) {
            return true;
        } else if (isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType, data)) {
            return true;
        } else if (isComponentType(targetType)) {
            return this.isTypeDescendent(targetType);
        }
        return false;
    }

    public static instance = new ComponentType('Node');

    isEqual(targetType: BscType): boolean {
        return isComponentType(targetType) && this.name.toLowerCase() === targetType.name.toLowerCase();
    }

    public toString() {
        return util.getSgNodeTypeName(this.name);
    }

    private builtInMemberTable: SymbolTable;

    getBuiltInMemberTable(): SymbolTable {
        if (!this.parentType) {
            if (this.builtInMemberTable) {
                return this.builtInMemberTable;
            }
            this.builtInMemberTable = new SymbolTable(`${this.__identifier} Built-in Members`);
            this.pushMemberProvider(() => this.builtInMemberTable);
            return this.builtInMemberTable;
        }
    }


    addBuiltInInterfaces() {
        if (!this.hasAddedBuiltInInterfaces) {
            if (this.parentType) {
                this.parentType.addBuiltInInterfaces();
            }
            BuiltInInterfaceAdder.addBuiltInInterfacesToType(this);
        }
        this.hasAddedBuiltInInterfaces = true;
        this.addBuiltInFields();
    }

    private hasAddedBuiltInFields = false;

    addBuiltInFields() {
        if (!this.hasAddedBuiltInFields) {
            BuiltInInterfaceAdder.addBuiltInFieldsToNodeType(this);
        }
        this.hasAddedBuiltInFields = true;
    }

    public readonly callFuncMemberTable: SymbolTable;

    addCallFuncMember(name: string, data: ExtraSymbolData, type: BaseFunctionType, flags: SymbolTypeFlag) {
        this.callFuncMemberTable.addSymbol(name, data, type, flags);
    }

    getCallFuncTable() {
        return this.callFuncMemberTable;
    }

    getCallFuncType(name: string, options: GetSymbolTypeOptions) {
        return this.callFuncMemberTable.getSymbolType(name, options);
    }
}

export const CallFuncMemberMethod = new TypedFunctionType(DynamicType.instance);
CallFuncMemberMethod.addParameter('functionName', StringType.instance, false);
CallFuncMemberMethod.isVariadic = true;

// Taken from: https://developer.roku.com/en-ca/docs/developer-program/core-concepts/handling-application-events.md#functional-fields
export const CallFuncDescription = `callFunc() is a synchronized interface on roSGNode. It will always execute in the component's owning ScriptEngine and thread (by rendezvous if necessary), and it will always use the m and m.top of the owning component. Any context from the caller can be passed via one or more method parameters, which may be of any type (previously, callFunc() only supported a single associative array parameter).\n\nTo call the function, use the \`callFunc\` field with the required method signature. A return value, if any, can be an object that is similarly arbitrary. The method being called must determine how to interpret the parameters included in the \`callFunc\` field.`;
