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
        return this.isEqual(targetType);
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
            //compare all parameters
            let len = Math.max(this.params.length, targetType.params.length);
            for (let i = 0; i < len; i++) {
                let myParam = this.params[i];
                let targetParam = targetType.params[i];
                if (!myParam || !targetParam || !myParam.type.isEqual(targetParam.type)) {
                    return false;
                }
            }

            //compare return type
            if (!this.returnType || !targetType.returnType || !this.returnType.isEqual(targetType.returnType)) {
                return false;
            }

            if (this.isVariadic !== targetType.isVariadic) {
                return false;
            }

            //made it here, all params and return type are equivalent
            return true;
        }
        return false;
    }
}

BuiltInInterfaceAdder.typedFunctionFactory = (returnType: BscType) => {
    return new TypedFunctionType(returnType);
};
