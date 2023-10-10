import { isDynamicType, isObjectType, isTypedFunctionType } from '../astUtils/reflection';
import { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

export class TypedFunctionType extends BaseFunctionType {
    constructor(
        public returnType: BscType
    ) {
        super();
    }

    public readonly kind = BscTypeKind.TypedFunctionType;

    /**
     * The name of the function for this type. Can be null
     */
    public name: string;

    /**
     * Determines if this is a sub or not
     */
    public isSub = false;

    /**
     * Does this function accept more args than just those in this.params
     */
    public isVariadic = false;

    public params = [] as Array<{ name: string; type: BscType; isOptional: boolean }>;

    public setName(name: string) {
        this.name = name;
        return this;
    }

    public addParameter(name: string, type: BscType, isOptional: boolean) {
        this.params.push({
            name: name,
            type: type,
            isOptional: isOptional === true ? true : false
        });
        return this;
    }

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        if (
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType, data)
        ) {
            return true;
        }
        if (isTypedFunctionType(targetType)) {
            return this.checkParamsAndReturnValue(targetType, true, (t1, t2) => t1.isTypeCompatible(t2));
        }
        return false;
    }

    public toString() {
        let paramTexts = [];
        for (let param of this.params) {
            paramTexts.push(`${param.name}${param.isOptional ? '?' : ''} as ${param.type.toString()}`);
        }
        let variadicText = '';
        if (this.isVariadic) {
            if (paramTexts.length > 0) {
                variadicText += ', ';
            }
            variadicText += '...';
        }
        return `${this.isSub ? 'sub' : 'function'} ${this.name ?? ''}(${paramTexts.join(', ')}${variadicText}) as ${this.returnType.toString()}`;
    }

    public toTypeString(): string {
        return 'Function';
    }

    isEqual(targetType: BscType) {
        if (isTypedFunctionType(targetType)) {
            return this.checkParamsAndReturnValue(targetType, false, (t1, t2) => t1.isEqual(t2));
        }
        return false;
    }

    private checkParamsAndReturnValue(targetType: TypedFunctionType, allowOptionalParamDifferences: boolean, predicate: (type1: BscType, type2: BscType) => boolean) {
        //compare all parameters
        let len = Math.max(this.params.length, targetType.params.length);
        for (let i = 0; i < len; i++) {
            let myParam = this.params[i];
            let targetParam = targetType.params[i];
            if (allowOptionalParamDifferences && !myParam && targetParam.isOptional) {
                // target func has MORE (optional) params... that's ok
                break;
            }

            if (!myParam || !targetParam || !predicate(targetParam.type, myParam.type)) {
                return false;
            }
            if (!allowOptionalParamDifferences && myParam.isOptional !== targetParam.isOptional) {
                return false;
            } else if (!myParam.isOptional && targetParam.isOptional) {
                return false;
            }
        }
        //compare return type
        if (!this.returnType || !targetType.returnType || !predicate(this.returnType, targetType.returnType)) {
            return false;
        }
        if (this.isVariadic !== targetType.isVariadic) {
            return false;
        }
        //made it here, all params and return type  pass predicate
        return true;
    }
}

BuiltInInterfaceAdder.typedFunctionFactory = (returnType: BscType) => {
    return new TypedFunctionType(returnType);
};
