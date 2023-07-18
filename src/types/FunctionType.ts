import { isDynamicType, isFunctionType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';

export class FunctionType extends BscType {
    constructor(
        public returnType: BscType
    ) {
        super();
    }

    public readonly kind = BscTypeKind.FunctionType;

    /**
     * The name of the function for this type. Can be null
     */
    public name: string;

    /**
     * Determines if this is a sub or not
     */
    public isSub = false;

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

    public isTypeCompatible(targetType: BscType) {
        if (
            isDynamicType(targetType) ||
            isObjectType(targetType)
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
        return `${this.isSub ? 'sub' : 'function'} ${this.name}(${paramTexts.join(', ')}) as ${this.returnType.toString()}`;

    }

    public toTypeString(): string {
        return 'Function';
    }

    isEqual(targetType: BscType) {
        if (isFunctionType(targetType)) {
            //compare all parameters
            let len = Math.max(this.params.length, targetType.params.length);
            for (let i = 0; i < len; i++) {
                let myParam = this.params[i];
                let targetParam = targetType.params[i];
                if (!myParam || !targetParam || !myParam.type.isAssignableTo(targetParam.type)) {
                    return false;
                }
            }

            //compare return type
            if (!this.returnType || !targetType.returnType || !this.returnType.isAssignableTo(targetType.returnType)) {
                return false;
            }

            //made it here, all params and return type are equivalent
            return true;
        }
        return false;
    }
}
