import { isCustomType } from '../astUtils';
import type { BscType, TypeContext } from './BscType';
import type { CustomType } from './CustomType';

/**
 * A type whose actual type is not computed until requested.
 * This is useful when the parser creates types in the middle of the file that depend on items further down in the file that haven't been parsed yet
 */
export class LazyType implements BscType {
    constructor(
        private factory: (context?: TypeContext) => BscType
    ) {
    }

    public get type() {
        return this.factory();
    }
    public getTypeFromContext(context?: TypeContext) {
        return this.factory(context);
    }

    public isAssignableTo(targetType: BscType, context?: TypeContext, potentialAncestorTypes?: CustomType[]) {
        const foundType = this.getTypeFromContext(context);
        if (isCustomType(foundType)) {
            return foundType.isAssignableTo(targetType, context, potentialAncestorTypes);
        }
        return foundType?.isAssignableTo(targetType, context);
    }

    public isConvertibleTo(targetType: BscType, context?: TypeContext) {
        return this.getTypeFromContext(context)?.isConvertibleTo(targetType, context);
    }

    public toString(context?: TypeContext) {
        return this.getTypeFromContext(context)?.toString(context);
    }

    public toTypeString(context?: TypeContext): string {
        return this.getTypeFromContext(context)?.toTypeString(context);
    }

    public equals(targetType: BscType, context?: TypeContext): boolean {
        return this.getTypeFromContext(context)?.equals(targetType, context);
    }
}
