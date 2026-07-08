import { expect } from 'chai';
import { StringType } from './StringType';
import { IntegerType } from './IntegerType';
import { IntersectionType } from './IntersectionType';
import { FloatType } from './FloatType';
import { InterfaceType } from './InterfaceType';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { BooleanType } from './BooleanType';
import { expectTypeToBe } from '../testHelpers.spec';
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

        expectTypeToBe(addressType, InterfaceType);
        expect(addressType).to.equal(addressInterfaceType);

        expectTypeToBe(ageType, IntersectionType);
        expect((ageType as IntersectionType).types.length).to.eq(2);
        expect((ageType as IntersectionType).types).to.include(FloatType.instance);
        expect((ageType as IntersectionType).types).to.include(IntegerType.instance);
    });

    it('can assign to a more specific Intersection', () => {
        const myInter = new IntersectionType([StringType.instance, FloatType.instance]);
        const otherInter = new IntersectionType([FloatType.instance, StringType.instance, BooleanType.instance]);

        expect(myInter.isTypeCompatible(otherInter)).to.be.true;
        expect(otherInter.isTypeCompatible(myInter)).to.be.false;
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

    it('inner type order does not affect equality', () => {
        const inter1 = new IntersectionType([StringType.instance, IntegerType.instance, FloatType.instance]);
        const inter2 = new IntersectionType([FloatType.instance, StringType.instance, IntegerType.instance]);
        expect(inter1.isEqual(inter2)).to.be.true;
    });

    it('more specific intersections are compatible with less specific ones', () => {
        const inter1 = new IntersectionType([StringType.instance, BooleanType.instance, FloatType.instance]);
        const inter2 = new IntersectionType([FloatType.instance, BooleanType.instance]);
        expect(inter1.isTypeCompatible(inter2)).to.be.false;
        expect(inter2.isTypeCompatible(inter1)).to.be.true;
    });


    it('more specific member interface is compatible with less specific ones', () => {
        const iFace1 = new InterfaceType('iFace1');
        iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
        iFace1.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);

        const iFace2 = new InterfaceType('iFace2');
        iFace2.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
        iFace2.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        iFace2.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);

        const inter1 = new IntersectionType([iFace1, StringType.instance]);
        const inter2 = new IntersectionType([iFace2, StringType.instance]);
        expect(inter2.isTypeCompatible(inter1)).to.be.false;
        expect(inter1.isTypeCompatible(inter2)).to.be.true;
    });


    it('interface is compatible with intersection with common members and vice versa', () => {
        const iFace1 = new InterfaceType('iFace1');
        iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
        iFace1.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);

        const iFace2 = new InterfaceType('iFace2');
        iFace2.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);

        const iFace3 = new InterfaceType('iFace3');
        iFace3.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);

        const inter = new IntersectionType([iFace2, iFace3]);
        expect(iFace1.isTypeCompatible(inter)).to.be.true;
        expect(inter.isTypeCompatible(iFace1)).to.be.true;
    });

    it('is not compatible when it must satisfy conflicting member types', () => {
        const iFace1 = new InterfaceType('iFace1');
        iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);

        const iFace2 = new InterfaceType('iFace2');
        iFace2.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);

        const inter = new IntersectionType([iFace1, iFace2]);

        const iFace3 = new InterfaceType('iFace3');
        iFace3.addMember('age', null, BooleanType.instance, SymbolTypeFlag.runtime);
        iFace3.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);

        expect(inter.isTypeCompatible(iFace3)).to.be.false;
        expect(iFace3.isTypeCompatible(inter)).to.be.false;
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


        it('will not return reference types if at least one inner type includes the member', () => {
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
            expectTypeToBe(heightType1, FloatType);

            // adding new member to iFace2, result will be intersection
            iFace2.addMember('height', null, BooleanType.instance, SymbolTypeFlag.runtime);
            const heightType2 = myInter.getMemberType('height', options);
            expectTypeToBe(heightType2, IntersectionType);
            const heightTypes2 = (heightType2 as IntersectionType).types;
            expect(heightTypes2.length).to.eq(2);
            expectTypeToBe(heightTypes2[0], FloatType);
            expectTypeToBe(heightTypes2[1], BooleanType);
        });
    });

});
