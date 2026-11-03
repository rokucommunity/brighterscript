import { expect } from '../chai-config.spec';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { expectTypeToBe } from '../testHelpers.spec';
import { AssociativeArrayType } from './AssociativeArrayType';
import { ClassType } from './ClassType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { InterfaceType } from './InterfaceType';
import { ObjectType } from './ObjectType';
import { StringType } from './StringType';
import { UnionType } from './UnionType';

describe('AssociativeArrayType', () => {
    it('stringifies as roAssociativeArray but transpiles as object', () => {
        const aa = new AssociativeArrayType();

        expect(aa.toString()).to.eql('roAssociativeArray');
        expect(aa.toTypeString()).to.eql('object');
    });

    it('is compatible with dynamic, object, and other AAs', () => {
        const aa = new AssociativeArrayType();

        expect(aa.isTypeCompatible(DynamicType.instance)).to.be.true;
        expect(aa.isTypeCompatible(new ObjectType())).to.be.true;
        expect(aa.isTypeCompatible(new AssociativeArrayType())).to.be.true;
    });

    it('is compatible with a class type', () => {
        const aa = new AssociativeArrayType();

        expect(aa.isTypeCompatible(new ClassType('Person'))).to.be.true;
    });

    it('is compatible with a union of compatible types', () => {
        const aa = new AssociativeArrayType();

        expect(
            aa.isTypeCompatible(new UnionType([new AssociativeArrayType(), new ObjectType()]))
        ).to.be.true;
    });

    it('is not compatible with primitives', () => {
        const aa = new AssociativeArrayType();

        expect(aa.isTypeCompatible(StringType.instance)).to.be.false;
        expect(aa.isTypeCompatible(IntegerType.instance)).to.be.false;
    });

    it('is not compatible with an interface that is missing its members', () => {
        const aa = new AssociativeArrayType();
        aa.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        aa.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);

        const iface = new InterfaceType('Named');
        iface.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);

        const data = {} as any;
        expect(aa.isTypeCompatible(iface, data)).to.be.false;
        //`age` is absent from the interface, so it's reported as a missing field
        expect(data.missingFields?.map(x => x.name)).to.include('age');
    });

    it('assumes unknown members are dynamic', () => {
        const aa = new AssociativeArrayType();

        expectTypeToBe(
            aa.getMemberType('whatever', { flags: SymbolTypeFlag.runtime }),
            DynamicType
        );
    });

    it('returns the declared type for members that were added', () => {
        const aa = new AssociativeArrayType();
        aa.addMember('count', null, IntegerType.instance, SymbolTypeFlag.runtime);

        expectTypeToBe(
            aa.getMemberType('count', { flags: SymbolTypeFlag.runtime }),
            IntegerType
        );
    });

    it('does not invent dynamic members when ignoreDefaultDynamicMembers is set', () => {
        const aa = new AssociativeArrayType();

        expect(
            aa.getMemberType('whatever', { flags: SymbolTypeFlag.runtime, ignoreDefaultDynamicMembers: true })
        ).to.be.undefined;
    });

    it('is equal to another AA with the same members', () => {
        const aa = new AssociativeArrayType();
        aa.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        const other = new AssociativeArrayType();
        other.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        const different = new AssociativeArrayType();
        different.addMember('name', null, IntegerType.instance, SymbolTypeFlag.runtime);

        expect(aa.isEqual(other)).to.be.true;
        expect(aa.isEqual(different)).to.be.false;
        expect(aa.isEqual(new ObjectType())).to.be.false;
    });

    it('reuses the same built-in member table across calls', () => {
        const aa = new AssociativeArrayType();

        const first = aa.getBuiltInMemberTable();
        const second = aa.getBuiltInMemberTable();

        expect(first).to.equal(second);
    });

    it('exposes the built-in member table as a member provider', () => {
        const aa = new AssociativeArrayType();
        aa.getBuiltInMemberTable().addSymbol('count', null, IntegerType.instance, SymbolTypeFlag.runtime);

        //the table is registered as a member provider, so the symbol is now reachable on the type
        expect(
            aa.getMemberTable().hasSymbol('count', SymbolTypeFlag.runtime)
        ).to.be.true;
    });
});
