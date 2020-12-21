import type { BscType } from './BscType';

/**
 * A type whose actual type is not computed until requested.
 * This is useful when the parser creates types in the middle of the file that depend on items further down in the file that haven't been parsed yet
 */
export class LazyType implements BscType {
    constructor(
        private factory: () => BscType
    ) {

    }

    public get type() {
        if (!this._type) {
            this._type = this.factory();
        }
        return this._type;
    }
    private _type: BscType;

    public isAssignableTo(targetType: BscType) {
        return this.type.isAssignableTo(targetType);
    }

    public isConvertibleTo(targetType: BscType) {
        return this.type.isConvertibleTo(targetType);
    }

    public toString() {
        return this.type.toString();
    }
}
