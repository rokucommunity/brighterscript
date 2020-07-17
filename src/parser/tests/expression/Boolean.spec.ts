import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser boolean expressions', () => {

    it('parses boolean ANDs', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.True, 'true', BrsBoolean.True),
            token(TokenKind.And, 'and'),
            token(TokenKind.False, 'false', BrsBoolean.False),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses boolean ORs', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.True, 'true', BrsBoolean.True),
            token(TokenKind.Or, 'or'),
            token(TokenKind.False, 'false', BrsBoolean.False),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1   2
         *    0   4   8   2   6   0
         *  +----------------------
         * 0| a = true and false
         */
        let { statements, diagnostics } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
                text: 'a',
                isReserved: false,
                range: Range.create(0, 0, 0, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(0, 2, 0, 3)
            },
            {
                kind: TokenKind.True,
                text: 'true',
                literal: BrsBoolean.True,
                isReserved: true,
                range: Range.create(0, 4, 0, 8)
            },
            {
                kind: TokenKind.And,
                text: 'and',
                isReserved: true,
                range: Range.create(0, 9, 0, 12)
            },
            {
                kind: TokenKind.False,
                text: 'false',
                literal: BrsBoolean.False,
                isReserved: true,
                range: Range.create(0, 13, 0, 18)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(0, 18, 0, 19)
            }
        ]) as any;

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].value.range).deep.include(
            Range.create(0, 4, 0, 18)
        );
    });
});
