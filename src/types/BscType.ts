import type { GetSymbolTypeOptions, SymbolTableProvider } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { ExtraSymbolData, TypeCompatibilityData } from '../interfaces';
import { isArrayType, isInheritableType, isReferenceType } from '../astUtils/reflection';

export abstract class BscType {

    public readonly memberTable: SymbolTable;
    protected __identifier: string;
    protected hasAddedBuiltInInterfaces = false;

    constructor(name = '') {
        this.__identifier = `${this.constructor.name}${name ? ': ' + name : ''}`;
        this.memberTable = new SymbolTable(this.__identifier);
    }

    pushMemberProvider(provider: SymbolTableProvider) {
        this.memberTable.pushParentProvider(provider);
    }

    popMemberProvider() {
        this.memberTable.popParentProvider();
    }

    getBuiltInMemberTable(): SymbolTable {
        return this.memberTable;
    }

    addMember(name: string, data: ExtraSymbolData, type: BscType, flags: SymbolTypeFlag) {
        this.memberTable.addSymbol(name, data, type, flags);
    }

    getMemberType(name: string, options: GetSymbolTypeOptions) {
        this.addBuiltInInterfaces();
        return this.memberTable.getSymbolType(name, options);
    }

    getMemberTable() {
        return this.memberTable;
    }

    isResolvable(): boolean {
        return true;
    }

    /**
     * Check if this type can be assigned to the target type
     * @param targetType the type that we're trying to assign this type to
     * @deprecated
     */
    isAssignableTo(targetType: BscType): boolean {
        return targetType.isTypeCompatible(this);
    }

    /**
     * Check if a different type can be assigned to this type - eg. does the other type convert into this type?
     * @param _otherType the type to check if it can be used as this type, or can automatically be converted into this type
     */
    isTypeCompatible(_otherType: BscType, data?: TypeCompatibilityData): boolean {
        throw new Error('Method not implemented.');
    }
    toString(): string {
        throw new Error('Method not implemented.');
    }
    toTypeString(): string {
        throw new Error('Method not implemented.');
    }

    isEqual(targetType: BscType, data: TypeCompatibilityData = {}): boolean {
        throw new Error('Method not implemented.');
    }

    checkCompatibilityBasedOnMembers(targetType: BscType, flags: SymbolTypeFlag, data: TypeCompatibilityData = {}) {
        if (!targetType) {
            return false;
        }
        let isSuperSet = true;
        data.missingFields ||= [];
        data.fieldMismatches ||= [];
        data.depth = data.depth ? data.depth + 1 : 1;
        //data.chain ||= [];
        this.addBuiltInInterfaces();
        targetType.addBuiltInInterfaces();

        if (this === targetType) {
            return true;
        }

        if (isReferenceType(targetType) && !targetType.isResolvable()) {
            // we can't resolve the other type. Assume it does not fail on member checks
            return true;
        }

        if (data.depth > 16) {
            // some sort of circular reference
            return false;
        }
        const mySymbols = this.getMemberTable()?.getAllSymbols(flags);
        for (const memberSymbol of mySymbols) {
            const targetTypesOfSymbol = targetType.getMemberTable()
                .getSymbolTypes(memberSymbol.name, { flags: flags })
                ?.map(symbol => symbol.type);
            if (!targetTypesOfSymbol || targetTypesOfSymbol.length === 0) {
                // eslint-disable-next-line no-bitwise
                if (!(memberSymbol.flags & SymbolTypeFlag.optional)) {
                    data.missingFields.push({ name: memberSymbol.name, expectedType: memberSymbol.type });
                    isSuperSet = false;
                }

            } else {
                isSuperSet =
                    (targetTypesOfSymbol ?? []).reduce((superSetSoFar, typeOfTargetSymbol) => {
                        if (!superSetSoFar) {
                            return superSetSoFar;
                        }
                        const typesAreInheritableWithSameName = isInheritableType(memberSymbol.type) && isInheritableType(typeOfTargetSymbol) &&
                            memberSymbol.type.name.toLowerCase() === typeOfTargetSymbol.name.toLowerCase();
                        const typesAreArraysWithSameDefault = isArrayType(memberSymbol.type) && isArrayType(typeOfTargetSymbol) &&
                            memberSymbol.type.defaultType.isEqual(typeOfTargetSymbol.defaultType);
                        const myMemberAllowsTargetType = typesAreInheritableWithSameName || typesAreArraysWithSameDefault || memberSymbol.type?.isTypeCompatible(typeOfTargetSymbol, { depth: data.depth });
                        if (!myMemberAllowsTargetType) {
                            data.fieldMismatches.push({ name: memberSymbol.name, expectedType: memberSymbol.type, actualType: targetType.getMemberType(memberSymbol.name, { flags: flags }) });
                        }
                        return superSetSoFar && myMemberAllowsTargetType;
                    }, true) && isSuperSet;
            }

        }
        data.depth = 0;
        return isSuperSet;
    }

    addBuiltInInterfaces() {
        if (!this.hasAddedBuiltInInterfaces) {
            BuiltInInterfaceAdder.addBuiltInInterfacesToType(this);
        }
        this.hasAddedBuiltInInterfaces = true;
    }
}
