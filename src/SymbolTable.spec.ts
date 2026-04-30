import { SymbolTable } from './SymbolTable';
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
        st.addSymbol('foo', null as any, new StringType());
        expect(st.getSymbol('FOO')!.length).eq(1);
        expect(st.getSymbol('FOO')![0].type.toString()).eq('string');
    });

    it('stores all previous symbols', () => {
        const st = new SymbolTable('Child');
        st.addSymbol('foo', null as any, new StringType());
        st.addSymbol('foo', null as any, new IntegerType());
        expect(st.getSymbol('FOO')!.length).eq(2);
    });


    it('reads from parent symbol table if not found in current', () => {
        const st = new SymbolTable('Child', () => parent);
        parent.addSymbol('foo', null as any, new StringType());
        expect(st.getSymbol('foo')![0].type.toString()).eq('string');
    });

    it('reads from current table if it exists', () => {
        const st = new SymbolTable('Child', () => parent);
        parent.addSymbol('foo', null as any, new StringType());
        st.addSymbol('foo', null as any, new IntegerType());
        expect(st.getSymbol('foo')![0].type.toString()).eq('integer');
    });

    it('correct checks if a symbol is in the table using hasSymbol', () => {
        const child = new SymbolTable('Child', () => parent);
        parent.addSymbol('foo', null as any, new StringType());
        child.addSymbol('bar', null as any, new IntegerType());
        expect(parent.hasSymbol('foo')).to.be.true;
        expect(parent.hasSymbol('bar')).to.be.false;
        expect(child.hasSymbol('foo')).to.be.true;
        expect(child.hasSymbol('bar')).to.be.true;
        expect(child.hasSymbol('buz')).to.be.false;
    });

    describe('mergeSymbolTable', () => {

        it('adds each symbol to the table', () => {
            const st = new SymbolTable('Child');
            st.addSymbol('foo', null as any, new StringType());
            const otherTable = new SymbolTable('OtherTable');
            otherTable.addSymbol('bar', null as any, new IntegerType());
            otherTable.addSymbol('foo', null as any, new IntegerType());
            st.mergeSymbolTable(otherTable);
        });

        it('shares symbol object references with the source rather than cloning', () => {
            const source = new SymbolTable('Source');
            source.addSymbol('foo', null as any, new StringType());
            const destination = new SymbolTable('Destination');
            destination.mergeSymbolTable(source);

            expect(destination.getSymbol('foo')![0]).to.equal(source.getSymbol('foo')![0]);
        });

        it('keeps destination isolated from later mutations to source', () => {
            const source = new SymbolTable('Source');
            source.addSymbol('foo', null as any, new StringType());
            const destination = new SymbolTable('Destination');
            destination.mergeSymbolTable(source);

            //adding to source after the merge must not leak into destination
            source.addSymbol('foo', null as any, new IntegerType());

            expect(destination.getSymbol('foo')!.length).to.eq(1);
            expect(destination.getSymbol('foo')![0].type.toString()).to.eq('string');
        });

        it('accumulates symbols when merging multiple sources sharing a key', () => {
            const sourceA = new SymbolTable('SourceA');
            sourceA.addSymbol('foo', null as any, new StringType());
            const sourceB = new SymbolTable('SourceB');
            sourceB.addSymbol('foo', null as any, new IntegerType());

            const destination = new SymbolTable('Destination');
            destination.mergeSymbolTable(sourceA);
            destination.mergeSymbolTable(sourceB);

            expect(
                destination.getSymbol('foo')!.map(symbol => symbol.type.toString())
            ).to.eql(['string', 'integer']);
        });
    });

    it('searches siblings before parents', () => {
        parent.addSymbol('alpha', null as any, new StringType());

        const child = new SymbolTable('Child', () => parent);

        const sibling = new SymbolTable('Sibling');
        child.addSibling(sibling);
        sibling.addSymbol('alpha', null as any, new BooleanType());

        expect(
            child.getSymbol('alpha')!.map(x => x.type.toTypeString())
        ).to.eql([
            'boolean'
        ]);
    });
});
