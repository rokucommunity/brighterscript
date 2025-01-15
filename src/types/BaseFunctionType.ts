import type { TypeCompatibilityData } from '../interfaces';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export abstract class BaseFunctionType extends BscType {

    public returnType: BscType = DynamicType.instance;
    public isBuiltIn = true;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData): boolean {
        throw new Error('Method not implemented.');
    }

    public toString() {
        return this.toTypeString();

    }

    public toTypeString(): string {
        return 'Function';
    }

    isEqual(targetType: BscType): boolean {
        throw new Error('Method not implemented.');
    }
}
