import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { createToken } from '../../../astUtils/creators';

describe('parser while statements', () => {

    it('while without exit', () => {
        const { statements, diagnostics } = Parser.parse([
            token(TokenKind.While, 'while'),
            createToken(TokenKind.True, 'true'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.Print, 'print'),
            createToken(TokenKind.StringLiteral, 'looping'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.EndWhile, 'end while'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('while with exit', () => {
        const { statements, diagnostics } = Parser.parse([
            token(TokenKind.While, 'while'),
            createToken(TokenKind.True, 'true'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.Print, 'print'),
            createToken(TokenKind.StringLiteral, 'looping'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.ExitWhile, 'exit while'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.EndWhile, 'end while'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 0| while true
         * 1|   Rnd(0)
         * 2| end while
         */
        const { statements, diagnostics } = Parser.parse([
            {
                kind: TokenKind.While,
                text: 'while',
                isReserved: true,
                range: Range.create(0, 0, 0, 5)
            },
            {
                kind: TokenKind.True,
                text: 'true',
                isReserved: true,
                range: Range.create(0, 6, 0, 10)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(0, 10, 0, 11)
            },
            // loop body isn't significant for location tracking, so helper functions are safe
            identifier('Rnd'),
            token(TokenKind.LeftParen, '('),
            createToken(TokenKind.IntegerLiteral),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\n'),
            {
                kind: TokenKind.EndWhile,
                text: 'end while',
                isReserved: false,
                range: Range.create(2, 0, 2, 9)
            },
            EOF
        ]);

        expect(diagnostics[0]?.message).not.to.exist;
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].range).deep.include(
            Range.create(0, 0, 2, 9)
        );
    });
});
