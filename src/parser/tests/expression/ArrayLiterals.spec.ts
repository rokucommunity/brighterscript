import { expect } from 'chai';

import { Parser } from '../../Parser';
import { BrsBoolean, Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser array literals', () => {
    describe('empty arrays', () => {
        it('on one line', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('on multiple lines', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    describe('filled arrays', () => {
        it('on one line', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('on multiple lines with commas', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Comma, ','),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Comma, ','),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('on multiple lines without commas', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    describe('contents', () => {
        it('can contain primitives', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('can contain other arrays', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.Comma, ','),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '4', new Int32(4)),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '6', new Int32(6)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('can contain expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Comma, ','),
                token(TokenKind.Not, 'not'),
                token(TokenKind.False, 'false', BrsBoolean.False),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1
         *    0   4   8   2
         *  +--------------
         * 0| a = [   ]
         * 1|
         * 2| b = [
         * 3|
         * 4|
         * 5| ]
         */
        let { statements, errors } = Parser.parse(<any>[
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
                kind: TokenKind.LeftSquareBracket,
                text: '[',
                isReserved: false,
                range: Range.create(0, 4, 0, 5)
            },
            {
                kind: TokenKind.RightSquareBracket,
                text: ']',
                isReserved: false,
                range: Range.create(0, 8, 0, 9)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(0, 9, 0, 10)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(1, 0, 1, 1)
            },
            {
                kind: TokenKind.Identifier,
                text: 'b',
                isReserved: false,
                range: Range.create(2, 0, 2, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(2, 2, 2, 3)
            },
            {
                kind: TokenKind.LeftSquareBracket,
                text: '[',
                isReserved: false,
                range: Range.create(2, 4, 2, 5)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(3, 0, 3, 1)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(4, 0, 4, 1)
            },
            {
                kind: TokenKind.RightSquareBracket,
                text: ']',
                isReserved: false,
                range: Range.create(5, 0, 5, 1)
            },
            {
                kind: TokenKind.Eof,
                text: '',
                isReserved: false,
                range: Range.create(5, 1, 5, 2)
            }
        ]) as any;

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(2);
        expect(statements[0].value.range).deep.include(
            Range.create(0, 4, 0, 9)
        );
        expect(statements[1].value.range).deep.include(
            Range.create(2, 4, 5, 1)
        );
    });
});
