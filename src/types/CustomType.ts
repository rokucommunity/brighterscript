import type { BscType } from './BscType';
import { ObjectType } from './ObjectType';

export class CustomType extends ObjectType implements BscType {

    constructor(public name: string) {
        super();
    }

    public toString(): string {
        return this.name;
    }

    public toTypeString(): string {
        return 'object';
    }

    public equals(targetType: BscType): boolean {
        return this.toString() === targetType.toString();
    }
}
