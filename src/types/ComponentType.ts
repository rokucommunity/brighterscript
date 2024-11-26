import type { BscSymbol, GetSymbolTypeOptions, SymbolTableProvider } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { SymbolTable } from '../SymbolTable';
import { isAnyReferenceType, isComponentType, isDynamicType, isObjectType, isPrimitiveType, isReferenceType, isTypedFunctionType } from '../astUtils/reflection';
import type { ExtraSymbolData, TypeCompatibilityData } from '../interfaces';
import type { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { InheritableType } from './InheritableType';
import { isUnionTypeCompatible } from './helpers';
import util from '../util';

export class ComponentType extends InheritableType {

    constructor(public name: string, superComponent?: ComponentType) {
        super(name, superComponent);
        this.callFuncMemberTable = new SymbolTable(`${this.name}: CallFunc`, () => this.parentComponent?.callFuncMemberTable);
        this.callFuncAssociatedTypesTable = new SymbolTable(`${this.name}: CallFuncAssociatedTypes`);
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

    isEqual(targetType: BscType, data: TypeCompatibilityData = {}): boolean {
        if (isReferenceType(targetType) && targetType.isResolvable()) {
            targetType = targetType.getTarget();
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

        return this.isParentTypeEqual(targetType, data) &&
            this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data) &&
            targetType.checkCompatibilityBasedOnMembers(this, SymbolTypeFlag.runtime, data) &&
            this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data, this.callFuncMemberTable) &&
            targetType.checkCompatibilityBasedOnMembers(this, SymbolTypeFlag.runtime, data, this.callFuncMemberTable);
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

    public readonly callFuncMemberTable: SymbolTable;
    public readonly callFuncAssociatedTypesTable: SymbolTable;

    /**
     * Adds a function to the call func member table
     * Also adds any associated custom types to its own table, so they can be used through a callfunc
     */
    addCallFuncMember(name: string, data: ExtraSymbolData, funcType: BaseFunctionType, flags: SymbolTypeFlag, associatedTypesTableProvider?: SymbolTableProvider) {
        const originalTypesToCheck = new Set<BscType>();
        if (isTypedFunctionType(funcType)) {
            const paramTypes = (funcType.params ?? []).map(p => p.type);
            for (const paramType of paramTypes) {
                originalTypesToCheck.add(paramType);
            }
        }
        if (funcType.returnType) {
            originalTypesToCheck.add(funcType.returnType);
        }
        const additionalTypesToCheck = new Set<BscType>();

        for (const type of originalTypesToCheck) {
            if (!type.isBuiltIn) {
                util.getCustomTypesInSymbolTree(additionalTypesToCheck, type, (subSymbol: BscSymbol) => {
                    return !originalTypesToCheck.has(subSymbol.type);
                });
            }
        }

        for (const type of [...originalTypesToCheck.values(), ...additionalTypesToCheck.values()]) {
            if (!isPrimitiveType(type) && type.isResolvable()) {
                // This type is a reference type, but was able to be resolved here
                // add it to the table of associated types, so it can be used through a callfunc
                const extraData = {};
                if (associatedTypesTableProvider) {
                    associatedTypesTableProvider().getSymbolType(type.toString(), { flags: SymbolTypeFlag.typetime, data: extraData });
                }
                let targetType = isAnyReferenceType(type) ? type.getTarget?.() : type;

                this.callFuncAssociatedTypesTable.addSymbol(type.toString(), { ...extraData, isFromCallFunc: true }, targetType, SymbolTypeFlag.typetime);
            }
        }

        // add this function to be available through callfunc
        this.callFuncMemberTable.addSymbol(name, data, funcType, flags);
    }

    getCallFuncTable() {
        return this.callFuncMemberTable;
    }

    getCallFuncType(name: string, options: GetSymbolTypeOptions) {
        const callFuncType = this.callFuncMemberTable.getSymbolType(name, options);

        const addAssociatedTypesTableAsSiblingToMemberTable = (type: BscType) => {
            if (isReferenceType(type) &&
                !type.isResolvable()) {
                // This param or return type is a reference - make sure the associated types are included
                type.tableProvider().addSibling(this.callFuncAssociatedTypesTable);

                // add this as a sister table to member tables too!
                const memberTable: SymbolTable = type.getMemberTable();
                if (memberTable.getAllSymbols) {
                    for (const memberSymbol of memberTable.getAllSymbols(SymbolTypeFlag.runtime)) {
                        addAssociatedTypesTableAsSiblingToMemberTable(memberSymbol?.type);
                    }
                }
            }
        };

        if (isTypedFunctionType(callFuncType)) {
            const typesToCheck = [...callFuncType.params.map(p => p.type), callFuncType.returnType];

            for (const type of typesToCheck) {
                addAssociatedTypesTableAsSiblingToMemberTable(type);
            }
        }

        return callFuncType;
    }
}

