import { expect } from '../chai-config.spec';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { expectTypeToBe } from '../testHelpers.spec';
import { IntegerType } from './IntegerType';
import { NamespaceType } from './NamespaceType';
import { StringType } from './StringType';

describe('NamespaceType', () => {
    it('stringifies as its name', () => {
        expect(new NamespaceType('Alpha').toString()).to.eql('Alpha');
        expect(new NamespaceType('Alpha.Beta').toString()).to.eql('Alpha.Beta');
    });

    it('is only equal to a namespace of the same name', () => {
        const alpha = new NamespaceType('Alpha');

        expect(alpha.isEqual(new NamespaceType('Alpha'))).to.be.true;
        expect(alpha.isEqual(new NamespaceType('Beta'))).to.be.false;
        expect(alpha.isEqual(StringType.instance)).to.be.false;
    });

    it('is only compatible with an equal namespace', () => {
        const alpha = new NamespaceType('Alpha');

        expect(alpha.isTypeCompatible(new NamespaceType('Alpha'))).to.be.true;
        expect(alpha.isTypeCompatible(new NamespaceType('Beta'))).to.be.false;
        expect(alpha.isTypeCompatible(IntegerType.instance)).to.be.false;
    });

    it('finds members that were added to it', () => {
        const alpha = new NamespaceType('Alpha');
        alpha.addMember('count', null, IntegerType.instance, SymbolTypeFlag.runtime);

        expectTypeToBe(
            alpha.getMemberType('count', { flags: SymbolTypeFlag.runtime }),
            IntegerType
        );
    });

    it('looks up members against its own member table', () => {
        const alpha = new NamespaceType('Alpha.Beta');
        alpha.addMember('Inner', null, new NamespaceType('Alpha.Beta.Inner'), SymbolTypeFlag.typetime);

        const inner = alpha.getMemberType('Inner', { flags: SymbolTypeFlag.typetime });

        expectTypeToBe(inner, NamespaceType);
        expect(inner.toString()).to.eql('Alpha.Beta.Inner');
    });
});
