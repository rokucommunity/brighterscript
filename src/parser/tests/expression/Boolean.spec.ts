import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { createToken } from '../../../astUtils/creators';

describe('parser boolean expressions', () => {

    it('parses boolean ANDs', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            createToken(TokenKind.True, 'true'),
            token(TokenKind.And, 'and'),
            createToken(TokenKind.False, 'false'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses boolean ORs', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            createToken(TokenKind.True, 'true'),
            token(TokenKind.Or, 'or'),
            createToken(TokenKind.False, 'false'),
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
