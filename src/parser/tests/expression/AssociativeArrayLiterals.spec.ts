import { expect } from 'chai';

import { Parser } from '../../parser';
import { BrsString, Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser associative array literals', () => {
    describe('empty associative arrays', () => {
        it('on one line', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.RightCurlyBrace, '}'),
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
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightCurlyBrace, '}'),
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
                token(TokenKind.LeftCurlyBrace, '{'),
                identifier('foo'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Comma, ','),
                identifier('bar'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Comma, ','),
                identifier('baz'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.RightCurlyBrace, '}'),
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
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.Newline, '\n'),
                identifier('foo'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Comma, ','),
                token(TokenKind.Newline, '\n'),
                identifier('bar'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Comma, ','),
                token(TokenKind.Newline, '\n'),
                identifier('baz'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightCurlyBrace, '}'),
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
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.Newline, '\n'),
                identifier('foo'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Newline, '\n'),
                identifier('bar'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Newline, '\n'),
                identifier('baz'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightCurlyBrace, '}'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    it('allows separating properties with colons', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.Sub, 'sub'),
            identifier('main'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\n'),
            identifier('person'),
            token(TokenKind.Equal, '='),
            token(TokenKind.LeftCurlyBrace, '{'),
            identifier('name'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.StringLiteral, 'Bob', new BrsString('Bob')),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            identifier('age'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.IntegerLiteral, '50', new Int32(3)),
            token(TokenKind.RightCurlyBrace, '}'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.EndSub, 'end sub'),
            EOF
        ]);
        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('allows a mix of quoted and unquoted keys', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.LeftCurlyBrace, '{'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.StringLiteral, 'foo', new BrsString('foo')),
            token(TokenKind.Colon, ':'),
            token(TokenKind.IntegerLiteral, '1', new Int32(1)),
            token(TokenKind.Comma, ','),
            token(TokenKind.Newline, '\n'),
            identifier('bar'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.IntegerLiteral, '2', new Int32(2)),
            token(TokenKind.Comma, ','),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.StringLiteral, 'requires-hyphens', new BrsString('requires-hyphens')),
            token(TokenKind.Colon, ':'),
            token(TokenKind.IntegerLiteral, '3', new Int32(3)),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.RightCurlyBrace, '}'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1
         *    0   4   8   2
         *  +--------------
         * 1| a = {   }
         * 2|
         * 3| b = {
         * 4|
         * 5|
         * 6| }
         */
        let { statements, errors } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
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
                kind: TokenKind.LeftCurlyBrace,
                text: '{',
                isReserved: false,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 5 }
                }
            },
            {
                kind: TokenKind.RightCurlyBrace,
                text: '}',
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
                kind: TokenKind.Identifier,
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
                kind: TokenKind.LeftCurlyBrace,
                text: '{',
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
                kind: TokenKind.RightCurlyBrace,
                text: '}',
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
        expect(statements[0].value.location).to.deep.include({
            start: { line: 1, column: 4 },
            end: { line: 1, column: 9 }
        });
        expect(statements[1].value.location).to.deep.include({
            start: { line: 3, column: 4 },
            end: { line: 6, column: 1 }
        });
    });
});
