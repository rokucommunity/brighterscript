import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { StringType } from './StringType';
import { expectTypeToBe } from '../testHelpers.spec';
import { IntegerType } from './IntegerType';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { TypedFunctionType } from './TypedFunctionType';
import { BooleanType } from './BooleanType';
import { FunctionType } from './FunctionType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { ClassType } from './ClassType';
import { ArrayType } from './ArrayType';
import { expect } from 'chai';
import { EnumMemberType, EnumType } from './EnumType';

describe('BuiltInInterfaceAdder', () => {

    it('should add members to StringType', () => {
        const myType = new StringType();
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);

        expectTypeToBe(myType.getMemberType('trim', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('split', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('getString', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('replace', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
    });

    it('should have correct types for string members', () => {
        const myType = new StringType();
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);
        const leftType = myType.getMemberType('left', { flags: SymbolTypeFlag.runtime });
        expectTypeToBe(leftType, TypedFunctionType);
        const leftFuncType = leftType as TypedFunctionType;
        expect(leftFuncType.params.length).to.equal(1);
        expectTypeToBe(leftFuncType.params[0].type, IntegerType);
        expectTypeToBe(leftFuncType.returnType, StringType);
    });

    it('should add members to IntegerType', () => {
        const myType = new IntegerType();
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);

        expectTypeToBe(myType.getMemberType('toStr', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('getInt', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
    });

    it('should add members to BooleanType', () => {
        const myType = new BooleanType();
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);

        expectTypeToBe(myType.getMemberType('toStr', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('getBoolean', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
    });

    it('should add members to DoubleType', () => {
        const myType = new DoubleType();
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);

        expectTypeToBe(myType.getMemberType('toStr', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('getDouble', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
    });

    it('should add members to FunctionType', () => {
        const myType = new FunctionType();
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);

        expectTypeToBe(myType.getMemberType('toStr', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('getSub', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
    });

    it('should add members to TypedFunctionType', () => {
        const myType = new TypedFunctionType(DynamicType.instance);
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);

        expectTypeToBe(myType.getMemberType('toStr', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('getSub', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
    });

    it('should add members to ArrayType', () => {
        const myType = new ArrayType();
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);

        expectTypeToBe(myType.getMemberType('push', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('getEntry', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('join', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
    });

    it('should not add members to ClassType', () => {
        const myType = new ClassType('Klass');
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);

        expect(myType.getMemberType('clear', { flags: SymbolTypeFlag.runtime }).isResolvable()).to.be.false;
        expect(myType.getMemberType('lookUp', { flags: SymbolTypeFlag.runtime }).isResolvable()).to.be.false;
    });

    it('should allow classes to override AA members', () => {
        const myType = new ClassType('Klass');
        myType.addMember('clear', null, new BooleanType(), SymbolTypeFlag.runtime);
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);
        expectTypeToBe(myType.getMemberType('clear', { flags: SymbolTypeFlag.runtime }), BooleanType);
    });

    it('should not include members that have already been overrided', () => {
        const myType = new ClassType('Klass');
        myType.addMember('clear', null, new BooleanType(), SymbolTypeFlag.runtime);
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);
        const myMembers = myType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime);
        expect(myMembers.filter(member => member.name.toLowerCase() === 'clear').length).to.eq(1);
    });

    it('should only add built ins to original ancestor', () => {
        const sup = new ClassType('SuperKlass');
        const sub = new ClassType('Klass', sup);
        sup.addMember('clear', null, new BooleanType(), SymbolTypeFlag.runtime);
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(sub);
        expectTypeToBe(sub.getMemberType('clear', { flags: SymbolTypeFlag.runtime }), BooleanType);
    });


    it('should respect overrides', () => {
        const myArray = new ArrayType(IntegerType.instance);
        const popType = myArray.getMemberType('pop', { flags: SymbolTypeFlag.runtime }) as TypedFunctionType;
        expectTypeToBe(popType.returnType, IntegerType);
        const pushType = myArray.getMemberType('push', { flags: SymbolTypeFlag.runtime }) as TypedFunctionType;
        expectTypeToBe(pushType.params[0].type, IntegerType);
    });

    it('works with enums', () => {
        const myEnum = new EnumType('myEnum', StringType.instance);
        const myEnumMember = new EnumMemberType('myEnum', 'member', StringType.instance);
        myEnum.addMember('member', {}, myEnumMember, SymbolTypeFlag.runtime);
        const enumTrim = myEnum.getMemberType('trim', { flags: SymbolTypeFlag.runtime });
        expect(enumTrim).to.be.undefined;
        const memberTrim = myEnumMember.getMemberType('trim', { flags: SymbolTypeFlag.runtime });
        expectTypeToBe(memberTrim, TypedFunctionType);
    });
});
