import { isDynamicType, isVoidType } from '../astUtils/reflection';
import { BscType } from './BscType';

export class VoidType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public static instance = new VoidType('void');

    public isTypeCompatible(targetType: BscType) {
        return (
            isVoidType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public toString() {
        return this.typeText ?? 'void';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType) {
        return isVoidType(targetType);
    }
}
