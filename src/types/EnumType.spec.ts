import { expect } from '../chai-config.spec';
import { ClassType } from './ClassType';
import { EnumMemberType, EnumType } from './EnumType';

describe('EnumType', () => {
    it('is equal to appropriate enum type', () => {
        expect(new EnumType('hello').isEqual(new ClassType('hello'))).to.be.false;
        expect(new EnumType('hello').isEqual(new EnumType('hello'))).to.be.true;
        expect(new EnumType('hello').isEqual(new EnumType('notHello'))).to.be.false;
    });

    it('is compatible with enum type that is the same', () => {
        expect(new EnumType('hello').isTypeCompatible(new ClassType('hello'))).to.be.false;
        expect(new EnumType('hello').isTypeCompatible(new EnumType('hello'))).to.be.true;
        expect(new EnumType('hello').isTypeCompatible(new EnumType('notHello'))).to.be.false;
    });

    it('is compatible with appropriate enum member type', () => {
        const myEnum = new EnumType('hello');
        expect(myEnum.isTypeCompatible(new EnumType('hello'))).to.be.true;
        const enumMember = new EnumMemberType(myEnum.name, 'someMember');
        const enumMember2 = new EnumMemberType('other', 'someMember');
        expect(myEnum.isTypeCompatible(enumMember)).to.be.true;
        expect(myEnum.isTypeCompatible(enumMember2)).to.be.false;
    });
});


describe('EnumMemberType', () => {
    it('is equal to appropriate enum member type', () => {
        expect(new EnumMemberType('a', 'b').isEqual(new EnumMemberType('a', 'b'))).to.be.true;
        expect(new EnumMemberType('a', 'b').isEqual(new EnumMemberType('a', 'c'))).to.be.false;
        expect(new EnumMemberType('a', 'b').isEqual(new EnumMemberType('d', 'b'))).to.be.false;
    });
});
