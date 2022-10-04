import { SymbolTable } from './SymbolTable';
import { expect } from './chai-config.spec';
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

    describe('mergeSymbolTable', () => {

        it('adds each symbol to the table', () => {
            const st = new SymbolTable();
            st.addSymbol('foo', null, new StringType());
            const otherTable = new SymbolTable();
            otherTable.addSymbol('bar', null, new IntegerType());
            otherTable.addSymbol('foo', null, new IntegerType());
            st.mergeSymbolTable(otherTable);
        });
    });
});
