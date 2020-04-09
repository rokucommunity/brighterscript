import { expect } from 'chai';

import { Parser } from '../../Parser';
import { BrsBoolean, BrsString, Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser while statements', () => {

    it('while without exit', () => {
        const { statements, diagnostics: errors } = Parser.parse([
            token(TokenKind.While, 'while'),
            token(TokenKind.True, 'true', BrsBoolean.True),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.Print, 'print'),
            token(TokenKind.StringLiteral, 'looping', new BrsString('looping')),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.EndWhile, 'end while'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('while with exit', () => {
        const { statements, diagnostics: errors } = Parser.parse([
            token(TokenKind.While, 'while'),
            token(TokenKind.True, 'true', BrsBoolean.True),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.Print, 'print'),
            token(TokenKind.StringLiteral, 'looping', new BrsString('looping')),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.ExitWhile, 'exit while'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.EndWhile, 'end while'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
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
        const { statements, diagnostics: errors } = Parser.parse([
            {
                kind: TokenKind.While,
                text: 'while',
                isReserved: true,
                range: Range.create(0, 0, 0, 5)
            },
            {
                kind: TokenKind.True,
                text: 'true',
                literal: BrsBoolean.True,
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
            token(TokenKind.IntegerLiteral, '0', new Int32(0)),
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

        expect(errors[0]?.message).not.to.exist;
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].range).deep.include(
            Range.create(0, 0, 2, 9)
        );
    });
});
