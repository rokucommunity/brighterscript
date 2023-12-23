import { isDynamicType, isInterfaceType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class InterfaceType implements BscType {
    public constructor(
        public members: Map<string, BscType>
    ) {

    }

    /**
     * The name of the interface. Can be null.
     */
    public name: string | undefined;

    public isAssignableTo(targetType: BscType) {
        //we must have all of the members of the target type, and they must be equivalent types
        if (isInterfaceType(targetType)) {
            for (const [targetMemberName, targetMemberType] of targetType.members) {
                const ourMemberType = this.members.get(targetMemberName);
                //we don't have the target member
                if (!ourMemberType) {
                    return false;
                }
                //our member's type is not assignable to the target member type
                if (!ourMemberType.isAssignableTo(targetMemberType)) {
                    return false;
                }
            }
            //we have all of the target member's types. we are assignable!
            return true;

            //we are always assignable to dynamic or object
        } else if (isDynamicType(targetType) || isObjectType(targetType)) {
            return true;

            //not assignable to any other object types
        } else {
            return false;
        }
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        let result = '{';
        for (const [key, type] of this.members.entries()) {
            result += ' ' + key + ': ' + type.toString() + ';';
        }
        if (this.members.size > 0) {
            result += ' ';
        }
        return result + '}';
    }

    public toTypeString(): string {
        return 'object';
    }

    public equals(targetType: BscType): boolean {
        if (isInterfaceType(targetType)) {
            if (targetType.members.size !== this.members.size) {
                return false;
            }
            return targetType.isAssignableTo(this);
        }
        return false;
    }
}
