import type { BscType } from './BscType';
import { ObjectType } from './ObjectType';

export class CustomType extends ObjectType implements BscType {

    constructor(public customTypeName: string) {
        super()
    }
}
