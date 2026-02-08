
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { isArrayType, isDynamicType, isEnumMemberType, isInvalidType, isObjectType, isTypeStatementType } from '../astUtils/reflection';
import type { TypeCompatibilityData } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import type { BuiltInInterfaceOverride } from './BuiltInInterfaceAdder';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { unionTypeFactory } from './UnionType';
import { getUniqueType, isUnionTypeCompatible } from './helpers';
import { util } from '../util';

export class ArrayType extends BscType {
    constructor(...innerTypes: BscType[]) {
        super();
        this.innerTypes = innerTypes;
    }

    public readonly kind = BscTypeKind.ArrayType;
    public isBuiltIn = true;

    public innerTypes: BscType[] = [];

    public _defaultType: BscType;
    private isCheckingInnerTypesForDefaultType = false;

    public get defaultType(): BscType {
        if (this._defaultType) {
            return this._defaultType;
        }
        if (this.innerTypes?.length === 0 || this.isCheckingInnerTypesForDefaultType) {
            return DynamicType.instance;
        }
        this.isCheckingInnerTypesForDefaultType = true;

        let resultType = this.innerTypes[0];
        if (this.innerTypes?.length > 1) {
            resultType = getUniqueType(this.innerTypes, unionTypeFactory) ?? DynamicType.instance;
        }
        if (isEnumMemberType(resultType)) {
            resultType = resultType.parentEnumType ?? resultType;
        }
        this._defaultType = util.getDefaultTypeFromValueType(resultType);
        this.isCheckingInnerTypesForDefaultType = false;
        return this._defaultType;
    }

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        while (isTypeStatementType(targetType)) {
            targetType = targetType.wrappedType;
        }
        if (isDynamicType(targetType)) {
            return true;
        } else if (isObjectType(targetType)) {
            return true;
        } else if (isInvalidType(targetType)) {
            return true;
        } else if (isUnionTypeCompatible(this, targetType)) {
            return true;
        } else if (isArrayType(targetType)) {
            const compatible = this.defaultType.isTypeCompatible(targetType.defaultType, data);
            if (data) {
                data.actualType = targetType.defaultType;
                data.expectedType = this.defaultType;
            }
            return compatible;
        } else if (this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data)) {
            return true;
        }
        return false;
    }

    public toString() {
        return `Array<${this.defaultType.toString()}>`;
    }

    public toTypeString(): string {
        return 'object';
    }

    public isEqual(targetType: BscType): boolean {
        if (isArrayType(targetType)) {
            if (targetType.innerTypes.length !== this.innerTypes.length) {
                return false;
            }
            for (let i = 0; i < this.innerTypes.length; i++) {
                if (!this.innerTypes[i].isEqual(targetType.innerTypes[i])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    addBuiltInInterfaces() {
        if (!this.hasAddedBuiltInInterfaces) {
            const overrideMap = new Map<string, BuiltInInterfaceOverride>();
            const defaultType = this.defaultType;
            overrideMap
                // ifArray
                .set('peek', { returnType: defaultType })
                .set('pop', { returnType: defaultType })
                .set('push', { parameterTypes: [defaultType] })
                .set('shift', { returnType: defaultType })
                .set('unshift', { parameterTypes: [defaultType] })
                .set('append', { parameterTypes: [this] })
                // ifArrayGet
                .set('get', { returnType: defaultType })
                // ifArraySet
                .set('get', { parameterTypes: [IntegerType.instance, defaultType] })
                //ifEnum
                .set('next', { returnType: defaultType });
            BuiltInInterfaceAdder.addBuiltInInterfacesToType(this, overrideMap);
        }
        this.hasAddedBuiltInInterfaces = true;
    }
}
