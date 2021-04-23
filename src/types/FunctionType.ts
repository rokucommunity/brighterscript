import { isFunctionType, isDynamicType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class FunctionType implements BscType {
    constructor(
        public returnType: BscType
    ) {
    }

    /**
     * The name of the function for this type. Can be null
     */
    public name: string;

    /**
     * Determines if this is a sub or not
     */
    public isSub = false;

    public params = [] as Array<{ name: string; type: BscType; isRequired: boolean }>;

    public setName(name: string) {
        this.name = name;
        return this;
    }

    public addParameter(name: string, type: BscType, isRequired: boolean) {
        this.params.push({
            name: name,
            type: type,
            isRequired: isRequired === false ? false : true
        });
        return this;
    }

    public isAssignableTo(targetType: BscType) {
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
        } else if (isDynamicType(targetType)) {
            return true;
        } else {
            return false;
        }
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        let paramTexts = [];
        for (let param of this.params) {
            paramTexts.push(`${param.name}${param.isRequired ? '' : '?'} as ${param.type.toString()}`);
        }
        return `${this.isSub ? 'sub' : 'function'} ${this.name ?? ''}(${paramTexts.join(', ')}) as ${this.returnType.toString()}`;

    }

    public toTypeString(): string {
        return 'Function';
    }

    public equals(targetType: BscType): boolean {
        return (isFunctionType(targetType)) && this.isAssignableTo(targetType);
    }
}
