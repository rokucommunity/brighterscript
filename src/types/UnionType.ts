import { BscType } from './BscType';

export class UnionType extends BscType {
    constructor(
        public types: BscType[]
    ) {
        super(joinTypesString(types));
        for (const type of this.types) {
            this.memberTable.addSibling(type.memberTable);
        }
    }

    public addType(type: BscType) {
        this.types.push(type);
        this.memberTable.addSibling(type.memberTable);
    }

    isAssignableTo(targetType: BscType): boolean {
        throw new Error('Method not implemented.');
    }
    isConvertibleTo(targetType: BscType): boolean {
        throw new Error('Method not implemented.');
    }
    toString(): string {
        return joinTypesString(this.types);
    }
    toTypeString(): string {
        return 'dynamic';
    }

}


function joinTypesString(types: BscType[]) {
    return types.map(t => t.toString()).join(' | ');
}
