import { isArrayType, isDynamicType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';
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
}

