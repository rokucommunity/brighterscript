import { SymbolTypeFlag } from '../SymbolTypeFlag';
import type { BscSymbol, GetSymbolTypeOptions, SymbolTableProvider } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import type { BscType } from './BscType';
import { InheritableType } from './InheritableType';
import util from '../util';
import type { ReferenceType } from './ReferenceType';
import type { ExtraSymbolData, TypeCompatibilityData } from '../interfaces';
import type { BaseFunctionType } from './BaseFunctionType';
import { isAnyReferenceType, isCallFuncableType, isPrimitiveType, isReferenceType, isTypedFunctionType } from '../astUtils/reflection';
import { addAssociatedTypesTableAsSiblingToMemberTable } from './helpers';

/**
 * A Type to represent types that support Callfunc syntax for members, eg. `someType@.someCallfunc()`
 */
export abstract class CallFuncableType extends InheritableType {
    constructor(name: string, parentType?: CallFuncableType | ReferenceType) {
        super(name, parentType);
        this.callFuncMemberTable = new SymbolTable(`${this.name}: CallFunc`, () => (this.parentType as CallFuncableType)?.callFuncMemberTable);
        this.callFuncAssociatedTypesTable = new SymbolTable(`${this.name}: CallFuncAssociatedTypes`, () => (this.parentType as CallFuncableType)?.callFuncAssociatedTypesTable);
    }

    public readonly callFuncMemberTable: SymbolTable;
    public readonly callFuncAssociatedTypesTable: SymbolTable;


    isEqual(targetType: BscType, data: TypeCompatibilityData = {}): boolean {
        if (this === targetType) {
            return true;
        }
        if (isReferenceType(targetType)) {
            return super.isEqual(targetType, data);
        }

        if (!isCallFuncableType(targetType)) {
            return false;
        }
        return super.isEqual(targetType, data) &&
            this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data, this.callFuncMemberTable, targetType.callFuncMemberTable) &&
            targetType.checkCompatibilityBasedOnMembers(this, SymbolTypeFlag.runtime, data, targetType.callFuncMemberTable, this.callFuncMemberTable);
    }


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

        if (isTypedFunctionType(callFuncType)) {
            const typesToCheck = [...callFuncType.params.map(p => p.type), callFuncType.returnType];

            for (const type of typesToCheck) {
                addAssociatedTypesTableAsSiblingToMemberTable(type, this.callFuncAssociatedTypesTable, SymbolTypeFlag.runtime);
            }
        }

        return callFuncType;
    }
}
