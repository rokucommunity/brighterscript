import { expect } from 'chai';
import { SymbolTable, SymbolTypeFlags } from '../SymbolTable';
import { expectTypeToBe } from '../testHelpers.spec';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { ReferenceType } from './ReferenceType';
import { StringType } from './StringType';
import { FloatType } from './FloatType';
import { CustomType } from './CustomType';

describe('ReferenceType', () => {
    it('defaults to dynamic type if it can not resolve', () => {
        expectTypeToBe(new ReferenceType('test', () => undefined), DynamicType);
        const table = new SymbolTable('testTable');
        expectTypeToBe(new ReferenceType('test', () => table), DynamicType);
        table.addSymbol('someVar', null, StringType.instance, SymbolTypeFlags.runtime);
        expectTypeToBe(new ReferenceType('test', () => table), DynamicType);
    });

    it('can resolve based on a symbol table', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someVar', () => table);
        table.addSymbol('someVar', null, StringType.instance, SymbolTypeFlags.runtime);
        expectTypeToBe(ref, StringType);
    });

    it('resolves before checking assigning and convertible', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someVar', () => table);
        table.addSymbol('someVar', null, IntegerType.instance, SymbolTypeFlags.runtime);
        expect(ref.isAssignableTo(IntegerType.instance)).to.be.true;
        expect(ref.isConvertibleTo(FloatType.instance)).to.be.true;
    });

    it('resolves before stringifying', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someKlass', () => table);
        table.addSymbol('someKlass', null, new CustomType('SomeKlass'), SymbolTypeFlags.runtime);
        expect(ref.toTypeString()).to.eq('object');
        expect(ref.toString()).to.eq('SomeKlass');
    });
});
