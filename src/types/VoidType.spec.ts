import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { VoidType } from './VoidType';

describe('VoidType', () => {
    it('is equivalent to dynamic types', () => {
        expect(new VoidType().isAssignableTo(new VoidType())).to.be.true;
        expect(new VoidType().isAssignableTo(new DynamicType())).to.be.true;
    });
});
