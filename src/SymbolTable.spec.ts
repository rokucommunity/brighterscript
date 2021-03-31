import { SymbolTable } from './SymbolTable';
import { expect } from 'chai';
import { StringType } from './types/StringType';
import type { Identifier } from './lexer';
import { TokenKind } from './lexer';
import { createToken } from './astUtils';
import { IntegerType } from './types/IntegerType';


function makeIdentifier(name: string): Identifier {
    return createToken(TokenKind.Identifier, name);
}

describe('SymbolTable', () => {
    it('is case insensitive', () => {
        const st = new SymbolTable();
        st.addSymbol(makeIdentifier('foo'), new StringType());
        expect(st.getSymbol('FOO').length).eq(1);
        expect(st.getSymbol('FOO')[0].type.toString()).eq('string');
    });

    it('stores all previous symbols', () => {
        const st = new SymbolTable();
        st.addSymbol(makeIdentifier('foo'), new StringType());
        st.addSymbol(makeIdentifier('foo'), new IntegerType());
        expect(st.getSymbol('FOO').length).eq(2);
    });


    it('reads from parent symbol table if not found in current', () => {
        const parent = new SymbolTable();
        const st = new SymbolTable(parent);
        parent.addSymbol(makeIdentifier('foo'), new StringType());
        expect(st.getSymbol('foo')[0].type.toString()).eq('string');
    });

    it('reads from current table if it exists', () => {
        const parent = new SymbolTable();
        const st = new SymbolTable(parent);
        parent.addSymbol(makeIdentifier('foo'), new StringType());
        st.addSymbol(makeIdentifier('foo'), new IntegerType());
        expect(st.getSymbol('foo')[0].type.toString()).eq('integer');
    });

    describe('getSymbolType', () => {
        it('gets the correct type if it exists', () => {
            const st = new SymbolTable();
            st.addSymbol(makeIdentifier('foo'), new StringType());
            expect(st.getSymbolType('foo').toString()).eq('string');
        });

        it('gets the type from the parent if it exists', () => {
            const parent = new SymbolTable();
            const st = new SymbolTable(parent);
            parent.addSymbol(makeIdentifier('foo'), new StringType());
            expect(st.getSymbolType('foo').toString()).eq('string');
        });

        it('returns dynamic if multiple assignments of different type', () => {
            // TODO - union types
            const st = new SymbolTable();
            st.addSymbol(makeIdentifier('foo'), new StringType());
            st.addSymbol(makeIdentifier('foo'), new IntegerType());
            expect(st.getSymbolType('foo').toString()).eq('dynamic');
        });

        it('returns the type if multiple assignments of same type', () => {
            const st = new SymbolTable();
            st.addSymbol(makeIdentifier('foo'), new StringType());
            st.addSymbol(makeIdentifier('foo'), new StringType());
            expect(st.getSymbol('foo').length).eq(2);
            expect(st.getSymbolType('foo').toString()).eq('string');
        });

        it('returns uninitialized if not found', () => {
            const st = new SymbolTable();
            expect(st.getSymbolType('foo').toString()).eq('uninitialized');
        });
    });
});
