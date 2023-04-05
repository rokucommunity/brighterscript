import { SymbolTable, SymbolTypeFlags } from './SymbolTable';
import { expect } from './chai-config.spec';
import { StringType } from './types/StringType';
import { IntegerType } from './types/IntegerType';
import { BooleanType } from './types/BooleanType';

describe('SymbolTable', () => {
    let parent: SymbolTable;

    beforeEach(() => {
        parent = new SymbolTable('Parent');
    });

    it('is case insensitive', () => {
        const st = new SymbolTable('Child');
        st.addSymbol('foo', null, new StringType());
        expect(st.getSymbol('FOO').length).eq(1);
        expect(st.getSymbol('FOO')[0].type.toString()).eq('string');
    });

    it('stores all previous symbols', () => {
        const st = new SymbolTable('Child');
        st.addSymbol('foo', null, new StringType());
        st.addSymbol('foo', null, new IntegerType());
        expect(st.getSymbol('FOO').length).eq(2);
    });


    it('reads from parent symbol table if not found in current', () => {
        const st = new SymbolTable('Child', () => parent);
        parent.addSymbol('foo', null, new StringType());
        expect(st.getSymbol('foo')[0].type.toString()).eq('string');
    });

    it('reads from current table if it exists', () => {
        const st = new SymbolTable('Child', () => parent);
        parent.addSymbol('foo', null, new StringType());
        st.addSymbol('foo', null, new IntegerType());
        expect(st.getSymbol('foo')[0].type.toString()).eq('integer');
    });

    it('correct checks if a symbol is in the table using hasSymbol', () => {
        const child = new SymbolTable('Child', () => parent);
        parent.addSymbol('foo', null, new StringType());
        child.addSymbol('bar', null, new IntegerType());
        expect(parent.hasSymbol('foo')).to.be.true;
        expect(parent.hasSymbol('bar')).to.be.false;
        expect(child.hasSymbol('foo')).to.be.true;
        expect(child.hasSymbol('bar')).to.be.true;
        expect(child.hasSymbol('buz')).to.be.false;
    });

    it('matches bitflags given', () => {
        const table = new SymbolTable('Child', () => parent);
        table.addSymbol('foo', null, new StringType(), SymbolTypeFlags.runtime);
        table.addSymbol('bar', null, new IntegerType(), SymbolTypeFlags.typetime);
        expect(table.hasSymbol('foo', SymbolTypeFlags.runtime)).to.be.true;
        expect(table.hasSymbol('bar', SymbolTypeFlags.runtime)).to.be.false;
        expect(table.hasSymbol('foo', SymbolTypeFlags.typetime)).to.be.false;
        expect(table.hasSymbol('bar', SymbolTypeFlags.typetime)).to.be.true;
    });



    describe('mergeSymbolTable', () => {

        it('adds each symbol to the table', () => {
            const st = new SymbolTable('Child');
            st.addSymbol('foo', null, new StringType());
            const otherTable = new SymbolTable('OtherTable');
            otherTable.addSymbol('bar', null, new IntegerType());
            otherTable.addSymbol('foo', null, new IntegerType());
            st.mergeSymbolTable(otherTable);
        });
    });

    it('searches siblings before parents', () => {
        parent.addSymbol('alpha', null, new StringType());

        const child = new SymbolTable('Child', () => parent);

        const sibling = new SymbolTable('Sibling');
        child.addSibling(sibling);
        sibling.addSymbol('alpha', null, new BooleanType());

        expect(
            child.getSymbol('alpha').map(x => x.type.toTypeString())
        ).to.eql([
            'boolean'
        ]);
    });
});
