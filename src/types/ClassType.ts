import type { SymbolTypeFlags } from '../SymbolTable';
import { isClassType, isDynamicType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';

export class ClassType extends BscType {

    constructor(public name: string, public readonly superClass?: ClassType | ReferenceType) {
        super(name);
        if (superClass) {
            this.memberTable.pushParentProvider(() => this.superClass.memberTable);
        }
    }

    getMemberType(name: string, flags: SymbolTypeFlags) {
        return super.getMemberType(name, flags) ?? new ReferenceType(name, flags, () => this.memberTable);
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        return 'dynamic';
    }

    isResolvable(): boolean {
        return this.superClass ? this.superClass.isResolvable() : true;
    }

    public isAssignableTo(targetType: BscType) {
        if (isClassType(targetType) && targetType.name === this.name) {
            return true;
        } else if (isDynamicType(targetType) || isObjectType(targetType)) {
            return true;
        } else {
            const ancestorTypes = this.getAncestorTypeList();
            if (ancestorTypes?.find(ancestorType => targetType.equals(ancestorType))) {
                return true;
            }
            return false;
        }
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public equals(targetType: BscType): boolean {
        return isClassType(targetType) && this.toString() === targetType?.toString();
    }

    protected getAncestorTypeList(): ClassType[] {
        const ancestors = [];
        let currentSuperClass = this.superClass;
        while (currentSuperClass) {
            if (isClassType(currentSuperClass)) {
                ancestors.push(currentSuperClass);
                currentSuperClass = currentSuperClass.superClass;
            } else {
                break;
            }
        }
        return ancestors;
    }
}
