import { SymbolTable } from './SymbolTable';
import { expect } from './chai-config.spec';
import { StringType } from './types/StringType';
import { IntegerType } from './types/IntegerType';
import { BooleanType } from './types/BooleanType';
import { SymbolTypeFlag } from './SymbolTableFlag';
import { expectTypeToBe } from './testHelpers.spec';

describe('SymbolTable', () => {
    let parent: SymbolTable;

    beforeEach(() => {
        parent = new SymbolTable('Parent');
    });

    it('is case insensitive', () => {
        const st = new SymbolTable('Child');
        st.addSymbol('foo', null, new StringType(), SymbolTypeFlag.runtime);
        expect(st.getSymbol('FOO', SymbolTypeFlag.runtime)[0].type.toString()).eq('string');
        expect(st.getSymbol('FOO', SymbolTypeFlag.runtime)[0].type.toString()).eq('string');
    });

    it('stores all previous symbols', () => {
        const st = new SymbolTable('Child');
        st.addSymbol('foo', null, new StringType(), SymbolTypeFlag.runtime);
        st.addSymbol('foo', null, new IntegerType(), SymbolTypeFlag.runtime);
        expect(st.getSymbol('FOO', SymbolTypeFlag.runtime).length).eq(2);
    });

    it('can remove symbols', () => {
        const st = new SymbolTable('Table');
        st.addSymbol('foo', null, new StringType(), SymbolTypeFlag.runtime);
        expectTypeToBe(st.getSymbolType('foo', { flags: SymbolTypeFlag.runtime }), StringType);
        st.removeSymbol('foo');
        expect(st.getSymbol('foo', SymbolTypeFlag.runtime)).to.be.undefined;
    });

    it('reads from parent symbol table if not found in current', () => {
        const st = new SymbolTable('Child', () => parent);
        parent.addSymbol('foo', null, new StringType(), SymbolTypeFlag.runtime);
        expect(st.getSymbol('foo', SymbolTypeFlag.runtime)[0].type.toString()).eq('string');
    });

    it('reads from current table if it exists', () => {
        const st = new SymbolTable('Child', () => parent);
        parent.addSymbol('foo', null, new StringType(), SymbolTypeFlag.runtime);
        st.addSymbol('foo', null, new IntegerType(), SymbolTypeFlag.runtime);
        expect(st.getSymbol('foo', SymbolTypeFlag.runtime)[0].type.toString()).eq('integer');
    });

    it('correct checks if a symbol is in the table using hasSymbol', () => {
        const child = new SymbolTable('Child', () => parent);
        parent.addSymbol('foo', null, new StringType(), SymbolTypeFlag.runtime);
        child.addSymbol('bar', null, new IntegerType(), SymbolTypeFlag.runtime);
        expect(parent.hasSymbol('foo', SymbolTypeFlag.runtime)).to.be.true;
        expect(parent.hasSymbol('bar', SymbolTypeFlag.runtime)).to.be.false;
        expect(child.hasSymbol('foo', SymbolTypeFlag.runtime)).to.be.true;
        expect(child.hasSymbol('bar', SymbolTypeFlag.runtime)).to.be.true;
        expect(child.hasSymbol('buz', SymbolTypeFlag.runtime)).to.be.false;
    });

    it('matches bitflags given', () => {
        const table = new SymbolTable('Child', () => parent);
        table.addSymbol('foo', null, new StringType(), SymbolTypeFlag.runtime);
        table.addSymbol('bar', null, new IntegerType(), SymbolTypeFlag.typetime);
        expect(table.hasSymbol('foo', SymbolTypeFlag.runtime)).to.be.true;
        expect(table.hasSymbol('bar', SymbolTypeFlag.runtime)).to.be.false;
        expect(table.hasSymbol('foo', SymbolTypeFlag.typetime)).to.be.false;
        expect(table.hasSymbol('bar', SymbolTypeFlag.typetime)).to.be.true;
    });

    describe('mergeSymbolTable', () => {

        it('adds each symbol to the table', () => {
            const st = new SymbolTable('Child');
            st.addSymbol('foo', null, new StringType(), SymbolTypeFlag.runtime);
            const otherTable = new SymbolTable('OtherTable');
            otherTable.addSymbol('bar', null, new IntegerType(), SymbolTypeFlag.runtime);
            otherTable.addSymbol('foo', null, new IntegerType(), SymbolTypeFlag.runtime);
            st.mergeSymbolTable(otherTable);
        });
    });

    it('searches siblings before parents', () => {
        parent.addSymbol('alpha', null, new StringType(), SymbolTypeFlag.runtime);

        const child = new SymbolTable('Child', () => parent);

        const sibling = new SymbolTable('Sibling');
        child.addSibling(sibling);
        sibling.addSymbol('alpha', null, new BooleanType(), SymbolTypeFlag.runtime);

        expect(
            child.getSymbol('alpha', SymbolTypeFlag.runtime).map(x => x.type.toTypeString())
        ).to.eql([
            'boolean'
        ]);
    });
});
