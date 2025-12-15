import { expect } from 'chai';
import { StringType } from './StringType';
import { IntegerType } from './IntegerType';
import { IntersectionType } from './IntersectionType';
import { FloatType } from './FloatType';
import { InterfaceType } from './InterfaceType';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { BooleanType } from './BooleanType';
import { expectTypeToBe } from '../testHelpers.spec';
import { isReferenceType } from '../astUtils/reflection';
import { SymbolTable } from '../SymbolTable';
import { ReferenceType } from './ReferenceType';


describe('IntersectionType', () => {

    it('has all the members of all types', () => {
        const iFace = new InterfaceType('Iface');
        iFace.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
        iFace.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        const iFace2 = new InterfaceType('Iface2');
        iFace2.addMember('age', null, FloatType.instance, SymbolTypeFlag.runtime);
        const addressInterfaceType = new InterfaceType('address');
        iFace2.addMember('address', null, addressInterfaceType, SymbolTypeFlag.runtime);
        iFace2.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);

        const myIntersection = new IntersectionType([iFace, iFace2]);
        const ageType = myIntersection.getMemberType('age', { flags: SymbolTypeFlag.runtime });
        const addressType = myIntersection.getMemberType('address', { flags: SymbolTypeFlag.runtime });
        const nameType = myIntersection.getMemberType('name', { flags: SymbolTypeFlag.runtime });

        expectTypeToBe(nameType, StringType);

        expectTypeToBe(addressType, IntersectionType);
        expect((addressType as IntersectionType).types.length).to.eq(2);
        expect((addressType as IntersectionType).types).to.include(addressInterfaceType);
        expect((addressType as IntersectionType).types.filter(isReferenceType).length).to.equal(1); // no address in iface1, so it is reference

        expectTypeToBe(ageType, IntersectionType);
        expect((ageType as IntersectionType).types.length).to.eq(2);
        expect((ageType as IntersectionType).types).to.include(FloatType.instance);
        expect((ageType as IntersectionType).types).to.include(IntegerType.instance);
    });

    it('can assign to a more general Intersection', () => {
        const myInter = new IntersectionType([StringType.instance, FloatType.instance]);
        const otheInter = new IntersectionType([FloatType.instance, StringType.instance, BooleanType.instance]);

        expect(myInter.isTypeCompatible(otheInter)).to.be.true;
        expect(otheInter.isTypeCompatible(myInter)).to.be.false;
    });


    it('will get a string representation in order given', () => {
        const iFace1 = new InterfaceType('SomeIface');
        iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
        iFace1.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        iFace1.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);
        const myInter = new IntersectionType([FloatType.instance, StringType.instance, BooleanType.instance, iFace1]);

        expect(myInter.toString()).to.eq('float and string and boolean and SomeIface');
    });

    it('isResolvable if any inner type is resolvable', () => {
        const refTable = new SymbolTable('test');
        const refType = new ReferenceType('SomeType', 'SomeType', SymbolTypeFlag.typetime, () => refTable);
        const myInter1 = new IntersectionType([refType, StringType.instance]);
        expect(myInter1.isResolvable()).to.be.true;

        const myInter2 = new IntersectionType([refType]);
        expect(myInter2.isResolvable()).to.be.false;
    });


    describe('getMemberType', () => {
        it('will find the intersection of inner types', () => {
            const iFace1 = new InterfaceType('iFace1');
            iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);

            const iFace2 = new InterfaceType('iFace2');
            iFace2.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
            iFace2.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
            iFace2.addMember('height', null, StringType.instance, SymbolTypeFlag.runtime);

            const myInter = new IntersectionType([iFace1, iFace2]);

            const options = { flags: SymbolTypeFlag.runtime };
            const ageType = myInter.getMemberType('age', options);
            expectTypeToBe(ageType, IntegerType);
            const nameType = myInter.getMemberType('name', options);
            expectTypeToBe(nameType, StringType);
            const heightType = myInter.getMemberType('height', options);
            expectTypeToBe(heightType, IntersectionType);
            const heightTypes = (heightType as IntersectionType).types;
            expect(heightTypes).to.include(FloatType.instance);
            expect(heightTypes).to.include(StringType.instance);
        });


        it('will return reference types if any inner type does not include the member', () => {
            const iFace1 = new InterfaceType('iFace1');
            iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);

            const iFace2 = new InterfaceType('iFace2');
            iFace2.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
            iFace2.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);

            const myInter = new IntersectionType([iFace1, iFace2]);
            const options = { flags: SymbolTypeFlag.runtime };
            const heightType1 = myInter.getMemberType('height', options);
            expectTypeToBe(heightType1, IntersectionType);
            const heightTypes1 = (heightType1 as IntersectionType).types;
            expect(heightTypes1.length).to.eq(2);
            expectTypeToBe(heightTypes1[0], FloatType);
            // height does not exist in iFace2
            expect(isReferenceType(heightTypes1[1])).to.be.true;
            expect(heightTypes1[1].isResolvable()).to.be.false;

            iFace2.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);
            const heightType2 = myInter.getMemberType('height', options);
            expectTypeToBe(heightType2, FloatType);
        });
    });

});

