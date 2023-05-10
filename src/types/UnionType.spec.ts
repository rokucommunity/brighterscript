import { expect } from 'chai';
import { StringType } from './StringType';
import { IntegerType } from './IntegerType';
import { UnionType } from './UnionType';
import { FloatType } from './FloatType';
import { InterfaceType } from './InterfaceType';
import { SymbolTypeFlags } from '../SymbolTable';
import { BooleanType } from './BooleanType';


describe('UnionType', () => {
    it('can be assigned to by anything that can be assigned to an included type', () => {
        const parentIFace = new InterfaceType('IfaceParent');
        parentIFace.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        const iFace = new InterfaceType('IfaceChild', parentIFace);
        iFace.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);

        const otheriFaceWithSameMembers = new InterfaceType('OtherIface');
        otheriFaceWithSameMembers.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        otheriFaceWithSameMembers.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);
        otheriFaceWithSameMembers.addMember('height', null, FloatType.instance, SymbolTypeFlags.runtime);

        const myUnion = new UnionType([FloatType.instance, iFace, StringType.instance]);

        expect(myUnion.isTypeCompatible(FloatType.instance)).to.be.true;
        expect(myUnion.isTypeCompatible(StringType.instance)).to.be.true;
        expect(myUnion.isTypeCompatible(otheriFaceWithSameMembers)).to.be.false;
        expect(otheriFaceWithSameMembers.isTypeCompatible(myUnion)).to.be.true;
    });

    it('can assign to a more general Union', () => {
        const myUnion = new UnionType([StringType.instance, FloatType.instance]);
        const otherUnion = new UnionType([FloatType.instance, StringType.instance, BooleanType.instance]);

        expect(myUnion.isTypeCompatible(otherUnion)).to.be.false;
        expect(otherUnion.isTypeCompatible(myUnion)).to.be.true;
    });

    it('can assign to a more general Union with interfaces', () => {
        const parentIFace = new InterfaceType('IfaceParent');
        parentIFace.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        const iFace = new InterfaceType('IfaceChild', parentIFace);
        iFace.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);
        iFace.addMember('height', null, FloatType.instance, SymbolTypeFlags.runtime);
        const myUnion = new UnionType([FloatType.instance, iFace, StringType.instance, BooleanType.instance]);

        const otheriFaceWithSameMembers = new InterfaceType('OtherIface');
        otheriFaceWithSameMembers.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        otheriFaceWithSameMembers.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);

        const otherUnion = new UnionType([FloatType.instance, otheriFaceWithSameMembers, StringType.instance]);

        expect(myUnion.isTypeCompatible(otherUnion)).to.be.true;
        expect(otherUnion.isTypeCompatible(myUnion)).to.be.false;
    });

});
