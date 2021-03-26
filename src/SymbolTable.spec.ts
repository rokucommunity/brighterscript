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
        expect(st.getSymbol('FOO').type.toString()).eq('string');
    });

    it('overwrites previous symbol', () => {
        const st = new SymbolTable();
        st.addSymbol(makeIdentifier('foo'), new StringType());
        st.addSymbol(makeIdentifier('foo'), new IntegerType());
        expect(st.getSymbol('foo').type.toString()).eq('integer');
    });

    it('reads from parent symbol table if not found in current', () => {
        const parent = new SymbolTable();
        const st = new SymbolTable(parent);
        parent.addSymbol(makeIdentifier('foo'), new StringType());
        expect(st.getSymbol('foo').type.toString()).eq('string');
    });

    it('reads from current table if it exists', () => {
        const parent = new SymbolTable();
        const st = new SymbolTable(parent);
        parent.addSymbol(makeIdentifier('foo'), new StringType());
        st.addSymbol(makeIdentifier('foo'), new IntegerType());
        expect(st.getSymbol('foo').type.toString()).eq('integer');
    });
});
