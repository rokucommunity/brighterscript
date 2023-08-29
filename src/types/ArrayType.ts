import { isArrayType, isDynamicType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import type { BuiltInInterfaceOverride } from './BuiltInInterfaceAdder';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { unionTypeFactory } from './UnionType';
import { getUniqueType, isUnionTypeCompatible } from './helpers';

export class ArrayType extends BscType {
    constructor(...innerTypes: BscType[]) {
        super();
        this.innerTypes = innerTypes;
    }

    public readonly kind = BscTypeKind.ArrayType;

    public innerTypes: BscType[] = [];

    public get defaultType(): BscType {
        if (this.innerTypes?.length === 0) {
            return DynamicType.instance;
        } else if (this.innerTypes?.length === 1) {
            return this.innerTypes[0];
        }
        return getUniqueType(this.innerTypes, unionTypeFactory);
    }

    public isTypeCompatible(targetType: BscType) {

        if (isDynamicType(targetType)) {
            return true;
        } else if (isObjectType(targetType)) {
            return true;
        } else if (isUnionTypeCompatible(this, targetType)) {
            return true;
        } else if (isArrayType(targetType)) {
            return this.defaultType.isTypeCompatible(targetType.defaultType);
        }
        return false;
    }

    public toString() {
        return `Array<${this.innerTypes.map((x) => x.toString()).join(' | ')}>`;
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

