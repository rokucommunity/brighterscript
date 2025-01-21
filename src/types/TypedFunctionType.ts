import { isDynamicType, isObjectType, isTypedFunctionType } from '../astUtils/reflection';
import { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';
import { CallExpression } from '../parser/Expression';

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

    public addParameter(name: string, type: BscType, isOptional = false) {
        this.params.push({
            name: name,
            type: type,
            isOptional: isOptional === true ? true : false
        });
        return this;
    }

    public seVariadic(variadic: boolean) {
        this.isVariadic = variadic;
        return this;
    }

    public isTypeCompatible(targetType: BscType, data: TypeCompatibilityData = {}) {
        if (
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType, data)
        ) {
            return true;
        }
        if (isTypedFunctionType(targetType)) {
            return this.checkParamsAndReturnValue(targetType, true, (t1, t2, d) => t1.isTypeCompatible(t2, d), data);
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

    isEqual(targetType: BscType, data: TypeCompatibilityData = {}) {
        if (isTypedFunctionType(targetType)) {
            if (this.toString().toLowerCase() === targetType.toString().toLowerCase()) {
                // this function has the same param names and types and return type as the target
                return true;
            }
            return this.checkParamsAndReturnValue(targetType, false, (t1, t2, predData = {}) => {
                return t1.isEqual(t2, { ...predData, allowNameEquality: true });
            }, data);
        }
        return false;
    }

    private checkParamsAndReturnValue(targetType: TypedFunctionType, allowOptionalParamDifferences: boolean, predicate: (type1: BscType, type2: BscType, data: TypeCompatibilityData) => boolean, data?: TypeCompatibilityData) {
        //compare all parameters
        let len = Math.max(this.params.length, targetType.params.length);
        for (let i = 0; i < len; i++) {
            let myParam = this.params[i];
            let targetParam = targetType.params[i];
            if (allowOptionalParamDifferences && !myParam && targetParam.isOptional) {
                // target func has MORE (optional) params... that's ok
                break;
            }

            if (!myParam || !targetParam || !predicate(targetParam.type, myParam.type, data)) {
                return false;
            }
            if (!allowOptionalParamDifferences && myParam.isOptional !== targetParam.isOptional) {
                return false;
            } else if (!myParam.isOptional && targetParam.isOptional) {
                return false;
            }
        }
        //compare return type
        if (!this.returnType || !targetType.returnType || !predicate(this.returnType, targetType.returnType, data)) {
            return false;
        }
        if (this.isVariadic !== targetType.isVariadic) {
            return false;
        }
        //made it here, all params and return type  pass predicate
        return true;
    }

    public getMinMaxParamCount(): { minParams: number; maxParams: number } {
        //get min/max parameter count for callable
        let minParams = 0;
        let maxParams = 0;
        for (let param of this.params) {
            maxParams++;
            //optional parameters must come last, so we can assume that minParams won't increase once we hit
            //the first isOptional
            if (param.isOptional !== true) {
                minParams++;
            }
        }
        if (this.isVariadic) {
            // function accepts variable number of arguments
            maxParams = CallExpression.MaximumArguments;
        }
        return { minParams: minParams, maxParams: maxParams };
    }
}

BuiltInInterfaceAdder.typedFunctionFactory = (returnType: BscType) => {
    return new TypedFunctionType(returnType);
};
