import { SymbolTable } from './SymbolTable';
import { expect } from 'chai';
import { StringType } from './types/StringType';
import { IntegerType } from './types/IntegerType';


describe('SymbolTable', () => {
    it('is case insensitive', () => {
        const st = new SymbolTable();
        st.addSymbol('foo', null, new StringType());
        expect(st.getSymbol('FOO').length).eq(1);
        expect(st.getSymbol('FOO')[0].type.toString()).eq('string');
    });

    it('stores all previous symbols', () => {
        const st = new SymbolTable();
        st.addSymbol('foo', null, new StringType());
        st.addSymbol('foo', null, new IntegerType());
        expect(st.getSymbol('FOO').length).eq(2);
    });


    it('reads from parent symbol table if not found in current', () => {
        const parent = new SymbolTable();
        const st = new SymbolTable(parent);
        parent.addSymbol('foo', null, new StringType());
        expect(st.getSymbol('foo')[0].type.toString()).eq('string');
    });

    it('reads from current table if it exists', () => {
        const parent = new SymbolTable();
        const st = new SymbolTable(parent);
        parent.addSymbol('foo', null, new StringType());
        st.addSymbol('foo', null, new IntegerType());
        expect(st.getSymbol('foo')[0].type.toString()).eq('integer');
    });

    it('correct checks if a symbol is in the table using hasSymbol', () => {
        const parent = new SymbolTable();
        const child = new SymbolTable(parent);
        parent.addSymbol('foo', null, new StringType());
        child.addSymbol('bar', null, new IntegerType());
        expect(parent.hasSymbol('foo')).to.be.true;
        expect(parent.hasSymbol('bar')).to.be.false;
        expect(child.hasSymbol('foo')).to.be.true;
        expect(child.hasSymbol('bar')).to.be.true;
        expect(child.hasSymbol('buz')).to.be.false;
    });

    describe('getSymbolType', () => {
        it('gets the correct type if it exists', () => {
            const st = new SymbolTable();
            st.addSymbol('foo', null, new StringType());
            expect(st.getSymbolType('foo').toString()).eq('string');
        });

        it('gets the type from the parent if it exists', () => {
            const parent = new SymbolTable();
            const st = new SymbolTable(parent);
            parent.addSymbol('foo', null, new StringType());
            expect(st.getSymbolType('foo').toString()).eq('string');
        });

        it('returns dynamic if multiple assignments of different type', () => {
            // TODO - union types
            const st = new SymbolTable();
            st.addSymbol('foo', null, new StringType());
            st.addSymbol('foo', null, new IntegerType());
            expect(st.getSymbolType('foo').toString()).eq('dynamic');
        });

        it('returns the type if multiple assignments of same type', () => {
            const st = new SymbolTable();
            st.addSymbol('foo', null, new StringType());
            st.addSymbol('foo', null, new StringType());
            expect(st.getSymbol('foo').length).eq(2);
            expect(st.getSymbolType('foo').toString()).eq('string');
        });

        it('returns undefined if not found', () => {
            const st = new SymbolTable();
            expect(st.getSymbolType('foo')).to.be.undefined;
        });
    });

    describe('mergeSymbolTable', () => {

        it('adds each symbol to the table', () => {
            const st = new SymbolTable();
            st.addSymbol('foo', null, new StringType());
            const otherTable = new SymbolTable();
            otherTable.addSymbol('bar', null, new IntegerType());
            otherTable.addSymbol('foo', null, new IntegerType());
            expect(st.getSymbolType('foo').toString()).eq('string');
            st.mergeSymbolTable(otherTable);
            expect(st.getSymbolType('foo').toString()).eq('dynamic');
            expect(st.getSymbolType('bar').toString()).eq('integer');
        });
    });
});
