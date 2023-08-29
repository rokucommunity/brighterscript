import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { StringType } from './StringType';
import { expectTypeToBe } from '../testHelpers.spec';
import { IntegerType } from './IntegerType';
import { SymbolTypeFlag } from '../SymbolTable';
import { TypedFunctionType } from './TypedFunctionType';
import { BooleanType } from './BooleanType';
import { FunctionType } from './FunctionType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { ClassType } from './ClassType';
import { ArrayType } from './ArrayType';
import { expect } from 'chai';

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

    it('should add members to ClassType', () => {
        const myType = new ClassType('Klass');
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);

        expectTypeToBe(myType.getMemberType('clear', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        expectTypeToBe(myType.getMemberType('lookUp', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
    });

    it('should allow classes to override built in members', () => {
        const myType = new ClassType('Klass');
        myType.addMember('clear', null, new BooleanType(), SymbolTypeFlag.runtime);
        BuiltInInterfaceAdder.addBuiltInInterfacesToType(myType);
        expectTypeToBe(myType.getMemberType('clear', { flags: SymbolTypeFlag.runtime }), BooleanType);
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
});
