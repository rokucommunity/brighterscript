import { expect } from 'chai';

import { Parser } from '../..';
import { BrsBoolean, Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

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
         * 1| a = [   ]
         * 2|
         * 3| b = [
         * 4|
         * 5|
         * 6| ]
         */
        let { statements, errors } = Parser.parse(<any>[
            {
                kind: TokenKind.IdentifierLiteral,
                text: 'a',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 1 }
                }
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 1, column: 2 },
                    end: { line: 1, column: 3 }
                }
            },
            {
                kind: TokenKind.LeftSquareBracket,
                text: '[',
                isReserved: false,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 5 }
                }
            },
            {
                kind: TokenKind.RightSquareBracket,
                text: ']',
                isReserved: false,
                location: {
                    start: { line: 1, column: 8 },
                    end: { line: 1, column: 9 }
                }
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 1, column: 9 },
                    end: { line: 1, column: 10 }
                }
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 2, column: 0 },
                    end: { line: 2, column: 1 }
                }
            },
            {
                kind: TokenKind.IdentifierLiteral,
                text: 'b',
                isReserved: false,
                location: {
                    start: { line: 3, column: 0 },
                    end: { line: 3, column: 1 }
                }
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 3, column: 2 },
                    end: { line: 3, column: 3 }
                }
            },
            {
                kind: TokenKind.LeftSquareBracket,
                text: '[',
                isReserved: false,
                location: {
                    start: { line: 3, column: 4 },
                    end: { line: 3, column: 5 }
                }
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 4, column: 0 },
                    end: { line: 4, column: 1 }
                }
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 5, column: 0 },
                    end: { line: 5, column: 1 }
                }
            },
            {
                kind: TokenKind.RightSquareBracket,
                text: ']',
                isReserved: false,
                location: {
                    start: { line: 6, column: 0 },
                    end: { line: 6, column: 1 }
                }
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 6, column: 1 },
                    end: { line: 6, column: 2 }
                }
            }
        ]) as any;

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(2);
        expect(statements[0].value.location).deep.include({
            start: { line: 1, column: 4 },
            end: { line: 1, column: 9 }
        });
        expect(statements[1].value.location).deep.include({
            start: { line: 3, column: 4 },
            end: { line: 6, column: 1 }
        });
    });
});
