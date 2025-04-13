/* eslint-disable no-bitwise */
import { SymbolTable } from './SymbolTable';
import { expect } from './chai-config.spec';
import { StringType } from './types/StringType';
import { IntegerType } from './types/IntegerType';
import { BooleanType } from './types/BooleanType';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import { expectTypeToBe } from './testHelpers.spec';
import { NamespaceType } from './types/NamespaceType';
import { TypedFunctionType } from './types/TypedFunctionType';
import { DynamicType, FloatType, UnionType } from './types';
import { util } from './util';
import type { AstNode } from './parser/AstNode';


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

    it('can check if something is an instance', () => {
        const table = new SymbolTable('Table');

        table.addSymbol('test', { isInstance: true }, DynamicType.instance, SymbolTypeFlag.runtime);

        expect(table.isSymbolTypeInstance('test')).to.true;
    });


    describe('mergeNamespaceSymbolTables', () => {

        it('merges namespace types', () => {
            const table1 = new SymbolTable('Table1');
            const table2 = new SymbolTable('Table2');

            const nsFlag = SymbolTypeFlag.runtime | SymbolTypeFlag.typetime;
            const alpha1 = new NamespaceType('alpha');
            const beta1 = new NamespaceType('beta');
            alpha1.addMember('beta', {}, beta1, nsFlag); // alpha.beta
            const someFunc = new TypedFunctionType(IntegerType.instance);

            alpha1.addMember('someFunc', {}, someFunc, SymbolTypeFlag.runtime); // alpha.someFunc
            beta1.addMember('ABC', {}, StringType.instance, SymbolTypeFlag.runtime); //alpha.beta.ABC

            const alpha2 = new NamespaceType('alpha');
            const beta2 = new NamespaceType('beta');
            alpha2.addMember('beta', {}, beta2, nsFlag); //alpha.beta
            beta2.addMember('DEF', {}, StringType.instance, SymbolTypeFlag.runtime); //alpha.beta.DEF
            const charlie2 = new NamespaceType('charlie');
            beta2.addMember('charlie', {}, charlie2, SymbolTypeFlag.runtime); //alpha.beta.charlie
            charlie2.addMember('XYZ', {}, IntegerType.instance, SymbolTypeFlag.runtime); //alpha.beta.charlie.XYZ

            table1.addSymbol('alpha', {}, alpha1, nsFlag);
            table2.addSymbol('alpha', {}, alpha2, nsFlag);

            const mergedTable = new SymbolTable('Merged');

            mergedTable.mergeNamespaceSymbolTables(table1);
            mergedTable.mergeNamespaceSymbolTables(table2);

            const alphaType = mergedTable.getSymbolType('alpha', { flags: nsFlag });
            expectTypeToBe(alphaType, NamespaceType);
            expectTypeToBe(alphaType.getMemberType('someFunc', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
            const betaType = alphaType.getMemberType('beta', { flags: nsFlag });
            expectTypeToBe(betaType, NamespaceType);
            expectTypeToBe(betaType.getMemberType('ABC', { flags: SymbolTypeFlag.runtime }), StringType);
            expectTypeToBe(betaType.getMemberType('DEF', { flags: SymbolTypeFlag.runtime }), StringType);
            const charlieType = betaType.getMemberType('charlie', { flags: nsFlag });

            expectTypeToBe(charlieType, NamespaceType);
            expectTypeToBe(charlieType.getMemberType('XYZ', { flags: SymbolTypeFlag.runtime }), IntegerType);

        });

        it('merges sibling tables', () => {
            const table1 = new SymbolTable('Table1');

            const nsFlag = SymbolTypeFlag.runtime | SymbolTypeFlag.typetime;
            const alpha1 = new NamespaceType('alpha');

            const someFunc = new TypedFunctionType(IntegerType.instance);

            const beta1 = new NamespaceType('beta');
            const alphaSibling = new SymbolTable('AlphaSibling');
            alphaSibling.addSymbol('beta', {}, beta1, nsFlag);
            alpha1.memberTable.addSibling(alphaSibling);
            const alphaSibling2 = new SymbolTable('AlphaSibling2');
            alphaSibling2.addSymbol('someFunc', {}, someFunc, SymbolTypeFlag.runtime);// alpha.someFunc
            alpha1.memberTable.addSibling(alphaSibling2);


            const betaSibling = new SymbolTable('BetaSibling');
            betaSibling.addSymbol('ABC', {}, StringType.instance, SymbolTypeFlag.runtime); //alpha.beta.ABC
            beta1.memberTable.addSibling(betaSibling);

            const table2 = new SymbolTable('Table2');

            const alpha2Sibling = new SymbolTable('Alpha2Sibling');
            const alpha2 = new NamespaceType('alpha');
            const beta2 = new NamespaceType('beta');
            alpha2Sibling.addSymbol('beta', {}, beta2, nsFlag); //alpha.beta
            alpha2.memberTable.addSibling(alpha2Sibling);

            const beta2Sibling = new SymbolTable('Beta2Sibling');
            beta2Sibling.addSymbol('DEF', {}, StringType.instance, SymbolTypeFlag.runtime); //alpha.beta.DEF
            beta2.memberTable.addSibling(beta2Sibling);

            const charlie2 = new NamespaceType('charlie');
            beta2.addMember('charlie', {}, charlie2, SymbolTypeFlag.runtime); //alpha.beta.charlie
            charlie2.addMember('XYZ', {}, IntegerType.instance, SymbolTypeFlag.runtime); //alpha.beta.charlie.XYZ

            table1.addSymbol('alpha', {}, alpha1, nsFlag);
            table2.addSymbol('alpha', {}, alpha2, nsFlag);

            const mergedTable = new SymbolTable('Merged');

            mergedTable.mergeNamespaceSymbolTables(table1);
            mergedTable.mergeNamespaceSymbolTables(table2);

            const alphaType = mergedTable.getSymbolType('alpha', { flags: nsFlag });
            expectTypeToBe(alphaType, NamespaceType);
            expectTypeToBe(alphaType.getMemberType('someFunc', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
            const betaType = alphaType.getMemberType('beta', { flags: nsFlag });
            expectTypeToBe(betaType, NamespaceType);
            expectTypeToBe(betaType.getMemberType('ABC', { flags: SymbolTypeFlag.runtime }), StringType);
            expectTypeToBe(betaType.getMemberType('DEF', { flags: SymbolTypeFlag.runtime }), StringType);
            const charlieType = betaType.getMemberType('charlie', { flags: nsFlag });

            expectTypeToBe(charlieType, NamespaceType);
            expectTypeToBe(charlieType.getMemberType('XYZ', { flags: SymbolTypeFlag.runtime }), IntegerType);
        });

    });

    describe.only('statementIndex and pocketTables', () => {

        function mockNodeWithIndex(index: number): AstNode {
            const fakeNode = { statementIndex: index } as AstNode;
            return fakeNode;
        }

        it('uses only the preceding assignment type', () => {
            const st = new SymbolTable('test');
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, StringType.instance, SymbolTypeFlag.runtime);
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(3) }, FloatType.instance, SymbolTypeFlag.runtime);
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(5) }, DynamicType.instance, SymbolTypeFlag.runtime);
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(7) }, BooleanType.instance, SymbolTypeFlag.runtime);
            let result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 2 });//last assignment is index 1, string
            expectTypeToBe(result, StringType);
            result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 4 });//last assignment is index 3, float
            expectTypeToBe(result, FloatType);
            result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 6 }); //last assignment is index 5, dynamic
            expectTypeToBe(result, DynamicType);
            result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 8 }); //last assignment is index 7, boolean
            expectTypeToBe(result, BooleanType);
        });

        it('order of types added to table doesnt matter - it still finds the correct index', () => {
            const st = new SymbolTable('test');
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(7) }, BooleanType.instance, SymbolTypeFlag.runtime);
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(3) }, FloatType.instance, SymbolTypeFlag.runtime);
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(5) }, DynamicType.instance, SymbolTypeFlag.runtime);
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, StringType.instance, SymbolTypeFlag.runtime);
            let result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 2 });//last assignment is index 1, string
            expectTypeToBe(result, StringType);
            result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 4 });//last assignment is index 3, float
            expectTypeToBe(result, FloatType);
            result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 6 }); //last assignment is index 5, dynamic
            expectTypeToBe(result, DynamicType);
            result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 8 }); //last assignment is index 7, boolean
            expectTypeToBe(result, BooleanType);
        });

        it('adds pocket tables', () => {
            const st = new SymbolTable('test');
            expect(st['pocketTables'].length).to.eq(0);
            const pt1 = new SymbolTable('pt1', () => st);
            st.addPocketTable({ index: 1, table: pt1 });
            expect(st['pocketTables'].length).to.eq(1);
        });

        it('searches pocket tables for a symbol', () => {
            const st = new SymbolTable('test');
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, StringType.instance, SymbolTypeFlag.runtime);
            const pt1 = new SymbolTable('pocket1', () => st);
            pt1.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, StringType.instance, SymbolTypeFlag.runtime);
            st.addPocketTable({ index: 2, table: pt1 });
            let result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 3 });
            expectTypeToBe(result, StringType);
        });

        it('does not search pocket tables before the preceding assignment for a symbol', () => {
            const st = new SymbolTable('test');
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(3) }, StringType.instance, SymbolTypeFlag.runtime);
            const pt1 = new SymbolTable('pocket1');
            pt1.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, IntegerType.instance, SymbolTypeFlag.runtime);
            st.addPocketTable({ index: 1, table: pt1 });
            let result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 5 });
            expectTypeToBe(result, StringType); // the pocket table is before the assignment, so it is not an integer
        });

        it('includes pocket tables results as a union type', () => {
            const st = new SymbolTable('test');
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, StringType.instance, SymbolTypeFlag.runtime);
            const pt1 = new SymbolTable('pocket1', () => st);
            pt1.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, IntegerType.instance, SymbolTypeFlag.runtime);
            st.addPocketTable({ index: 2, table: pt1 });
            const pt2 = new SymbolTable('pocket2', () => st);
            pt2.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, BooleanType.instance, SymbolTypeFlag.runtime);
            st.addPocketTable({ index: 3, table: pt2 });
            let result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 8 });
            expectTypeToBe(result, UnionType);
            expect((result as UnionType).types.length).to.eq(3);
            expect((result as UnionType).types).include(StringType.instance);
            expect((result as UnionType).types).include(BooleanType.instance);
            expect((result as UnionType).types).include(IntegerType.instance);
        });

        it('includes only last pocket tables results', () => {
            const st = new SymbolTable('test');
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, StringType.instance, SymbolTypeFlag.runtime);
            const pt1 = new SymbolTable('pocket1', () => st);
            pt1.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, IntegerType.instance, SymbolTypeFlag.runtime); // ignored
            pt1.addSymbol('someVar', { definingNode: mockNodeWithIndex(2) }, StringType.instance, SymbolTypeFlag.runtime);
            st.addPocketTable({ index: 2, table: pt1 });
            const pt2 = new SymbolTable('pocket2', () => st);
            pt2.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, BooleanType.instance, SymbolTypeFlag.runtime); // ignored
            pt2.addSymbol('someVar', { definingNode: mockNodeWithIndex(2) }, FloatType.instance, SymbolTypeFlag.runtime); // ignored
            pt2.addSymbol('someVar', { definingNode: mockNodeWithIndex(3) }, DynamicType.instance, SymbolTypeFlag.runtime); // ignored
            pt2.addSymbol('someVar', { definingNode: mockNodeWithIndex(4) }, StringType.instance, SymbolTypeFlag.runtime);
            st.addPocketTable({ index: 3, table: pt2 });
            let result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 8 });
            expectTypeToBe(result, StringType);
        });

        it('type in a pocket table takes into account only preceding assignments in the parent table', () => {
            const st = new SymbolTable('test');
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(1) }, FloatType.instance, SymbolTypeFlag.runtime);
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(2) }, StringType.instance, SymbolTypeFlag.runtime);
            const pt1 = new SymbolTable('pocket1', () => st);
            pt1.addSymbol('someVar', { definingNode: mockNodeWithIndex(2) }, DynamicType.instance, SymbolTypeFlag.runtime);
            pt1.addSymbol('someVar', { definingNode: mockNodeWithIndex(4) }, IntegerType.instance, SymbolTypeFlag.runtime);
            st.addPocketTable({ index: 3, table: pt1 });
            st.addSymbol('someVar', { definingNode: mockNodeWithIndex(4) }, BooleanType.instance, SymbolTypeFlag.runtime);

            // type as it enters the pocket table
            let result = pt1.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 0 });
            expectTypeToBe(result, StringType);

            // type after first assignment in the the pocket table
            result = pt1.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 3 });
            expectTypeToBe(result, DynamicType);

            // type after second assignment in the the pocket table
            result = pt1.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 5 });
            expectTypeToBe(result, IntegerType);

            // type in main table after the pocket table - union of before pocket table and end of pocket table
            result = st.getSymbolType('someVar', { flags: SymbolTypeFlag.runtime, statementIndex: 4 });
            expectTypeToBe(result, UnionType);
            expect((result as UnionType).types.length).to.eq(2);
            expect((result as UnionType).types).include(StringType.instance);
            expect((result as UnionType).types).include(IntegerType.instance);
        });

    });
});
