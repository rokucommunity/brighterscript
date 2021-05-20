import { isCustomType } from '../astUtils';
import type { BrsFile } from '../files/BrsFile';
import type { Scope } from '../Scope';
import type { BscType } from './BscType';
import type { CustomType } from './CustomType';

/**
 * A type whose actual type is not computed until requested.
 * This is useful when the parser creates types in the middle of the file that depend on items further down in the file that haven't been parsed yet
 */
export class LazyType implements BscType {
    constructor(
        private factory: (context?: LazyTypeContext) => BscType
    ) {

    }

    public get type() {
        return this.factory();
    }
    public getTypeFromContext(context?: LazyTypeContext) {
        return this.factory(context);
    }

    public isAssignableTo(targetType: BscType, context?: LazyTypeContext, potentialAncestorTypes?: CustomType[]) {
        const foundType = this.getTypeFromContext(context);
        if (isCustomType(foundType)) {
            return foundType.isAssignableTo(targetType, potentialAncestorTypes);
        }
        return foundType.isAssignableTo(targetType);
    }

    public isConvertibleTo(targetType: BscType) {
        return this.type.isConvertibleTo(targetType);
    }

    public toString() {
        return this.type.toString();
    }

    public toTypeString(): string {
        return this.type.toTypeString();
    }

    public equals(targetType: BscType): boolean {
        return this.type?.equals(targetType);
    }
}


export interface LazyTypeContext {
    file?: BrsFile;
    scope?: Scope;
}
