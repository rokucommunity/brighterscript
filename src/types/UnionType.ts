import type { BscType } from './BscType';

export class UnionType implements BscType {
    constructor(
        public types: BscType[]
    ) {
    }

    public addType(type: BscType) {
        this.types.push(type);
    }

    isAssignableTo(targetType: BscType): boolean {
        throw new Error('Method not implemented.');
    }
    isConvertibleTo(targetType: BscType): boolean {
        throw new Error('Method not implemented.');
    }
    toString(): string {
        throw new Error('Method not implemented.');
    }
    toTypeString(): string {
        throw new Error('Method not implemented.');
    }

}
