import type { GetSymbolTypeOptions, SymbolTypeFlag } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import { isComponentType, isDynamicType, isObjectType } from '../astUtils/reflection';
import type { ExtraSymbolData } from '../interfaces';
import type { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { InheritableType } from './InheritableType';
import { isUnionTypeCompatible } from './helpers';
import util from '../util';

export class ComponentType extends InheritableType {

    constructor(public name: string, public readonly superComponent?: ComponentType) {
        super(name, superComponent);
        this.callFuncMemberTable = new SymbolTable(`${this.name}: CallFunc`, () => this.superComponent?.callFuncMemberTable);
    }

    public readonly kind = BscTypeKind.ComponentType;

    public isTypeCompatible(targetType: BscType) {
        if (this.isEqual(targetType)) {
            return true;
        } else if (isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType)) {
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

    private callFuncMemberTable: SymbolTable;

    addCallFuncMember(name: string, data: ExtraSymbolData, type: BaseFunctionType, flags: SymbolTypeFlag) {
        this.callFuncMemberTable.addSymbol(name, undefined, type, flags);
    }

    getCallFuncTable() {
        return this.callFuncMemberTable;
    }

    getCallFuncType(name: string, options: GetSymbolTypeOptions) {
        return this.callFuncMemberTable.getSymbolType(name, options);
    }
}
