import { isDynamicType, isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { isInheritableType } from './InheritableType';

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
        if (isDynamicType(targetType)) {
            return true;
        }
        if (isInheritableType(targetType)) {
            let isAssignable = true;
            for (const currentType of this.types) {
                // assignable to target if each of these types can assign to target
                if (!currentType.isAssignableTo(targetType)) {
                    isAssignable = false;
                    break;
                }
            }
            return isAssignable;
        }
        if (isUnionType(targetType)) {
            let isAssignable = true;
            for (const currentType of this.types) {
                // assignable to target if each of these types can assign to target
                if (!targetType.canBeAssignedFrom(currentType)) {
                    isAssignable = false;
                    break;
                }
            }
            return isAssignable;
        }

        return false;
    }


    isConvertibleTo(targetType: BscType): boolean {
        return this.isAssignableTo(targetType);
    }
    toString(): string {
        return joinTypesString(this.types);
    }
    toTypeString(): string {
        return 'dynamic';
    }

    canBeAssignedFrom(targetType: BscType) {
        return !!this.types.find(t => targetType?.isAssignableTo(t));
    }

}


function joinTypesString(types: BscType[]) {
    return types.map(t => t.toString()).join(' | ');
}

