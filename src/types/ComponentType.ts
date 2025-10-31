import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { SymbolTable } from '../SymbolTable';
import { isComponentType, isDynamicType, isInvalidType, isObjectType, isReferenceType } from '../astUtils/reflection';
import type { TypeCompatibilityData } from '../interfaces';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { isUnionTypeCompatible } from './helpers';
import util from '../util';
import { CallFuncableType } from './CallFuncableType';

export class ComponentType extends CallFuncableType {

    constructor(public name: string, superComponent?: ComponentType) {
        super(name, superComponent);
    }

    public readonly kind = BscTypeKind.ComponentType;

    public get parentComponent() {
        return this.parentType as ComponentType;
    }

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        if (this.isEqual(targetType)) {
            return true;
        } else if (isInvalidType(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType, data)) {
            return true;
        } else if (isComponentType(targetType)) {
            return this.isTypeDescendent(targetType);
        }
        return false;
    }

    public static instance = new ComponentType('Node');

    isEqual(targetType: BscType, data: TypeCompatibilityData = {}): boolean {
        if (isReferenceType(targetType) && targetType.isResolvable()) {
            targetType = targetType.getTarget?.() ?? targetType;
        }
        if (this === targetType) {
            return true;
        }
        if (!isComponentType(targetType)) {
            return false;
        }

        const thisNameLower = this.name.toLowerCase();
        const targetNameLower = targetType.name.toLowerCase();
        if (thisNameLower !== targetNameLower) {
            return false;
        }
        if (this.isBuiltIn && targetType.isBuiltIn) {
            return true;
        }

        if (!this.isParentTypeEqual(targetType, data)) {
            return false;
        }
        if (!this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data) ||
            !targetType.checkCompatibilityBasedOnMembers(this, SymbolTypeFlag.runtime, data)) {
            return false;
        }
        if (!this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data, this.callFuncMemberTable, targetType.callFuncMemberTable) ||
            !targetType.checkCompatibilityBasedOnMembers(this, SymbolTypeFlag.runtime, data, targetType.callFuncMemberTable, this.callFuncMemberTable)) {
            return false;
        }

        return true;
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

    private hasStartedAddingBuiltInInterfaces = false;

    addBuiltInInterfaces() {
        if (!this.hasAddedBuiltInInterfaces && !this.hasStartedAddingBuiltInInterfaces) {
            this.hasStartedAddingBuiltInInterfaces = true;
            if (this.parentType) {
                this.parentType.addBuiltInInterfaces();
            }
            BuiltInInterfaceAdder.addBuiltInInterfacesToType(this);
        }
        this.hasAddedBuiltInInterfaces = true;
        this.addBuiltInFields();
    }

    private hasAddedBuiltInFields = false;
    private hasStartedAddingBuiltInFields = false;


    addBuiltInFields() {
        if (!this.hasAddedBuiltInFields && !this.hasStartedAddingBuiltInFields) {
            this.hasStartedAddingBuiltInFields = true;
            if (isComponentType(this.parentType)) {
                this.parentType.addBuiltInFields();
            }
            BuiltInInterfaceAdder.addBuiltInFieldsToNodeType(this);
        }
        this.hasAddedBuiltInFields = true;
    }
}

