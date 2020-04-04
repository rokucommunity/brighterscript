import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString, Int32 } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser associative array literals', () => {
    describe('empty associative arrays', () => {
        it('on one line', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.LeftBrace, '{'),
                token(Lexeme.RightBrace, '}'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('on multiple lines', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.LeftBrace, '{'),
                token(Lexeme.Newline, '\n'),
                token(Lexeme.Newline, '\n'),
                token(Lexeme.Newline, '\n'),
                token(Lexeme.Newline, '\n'),
                token(Lexeme.Newline, '\n'),
                token(Lexeme.Newline, '\n'),
                token(Lexeme.RightBrace, '}'),
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
                token(Lexeme.Equal, '='),
                token(Lexeme.LeftBrace, '{'),
                identifier('foo'),
                token(Lexeme.Colon, ':'),
                token(Lexeme.Integer, '1', new Int32(1)),
                token(Lexeme.Comma, ','),
                identifier('bar'),
                token(Lexeme.Colon, ':'),
                token(Lexeme.Integer, '2', new Int32(2)),
                token(Lexeme.Comma, ','),
                identifier('baz'),
                token(Lexeme.Colon, ':'),
                token(Lexeme.Integer, '3', new Int32(3)),
                token(Lexeme.RightBrace, '}'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('on multiple lines with commas', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.LeftBrace, '{'),
                token(Lexeme.Newline, '\n'),
                identifier('foo'),
                token(Lexeme.Colon, ':'),
                token(Lexeme.Integer, '1', new Int32(1)),
                token(Lexeme.Comma, ','),
                token(Lexeme.Newline, '\n'),
                identifier('bar'),
                token(Lexeme.Colon, ':'),
                token(Lexeme.Integer, '2', new Int32(2)),
                token(Lexeme.Comma, ','),
                token(Lexeme.Newline, '\n'),
                identifier('baz'),
                token(Lexeme.Colon, ':'),
                token(Lexeme.Integer, '3', new Int32(3)),
                token(Lexeme.Newline, '\n'),
                token(Lexeme.RightBrace, '}'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('on multiple lines without commas', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.LeftBrace, '{'),
                token(Lexeme.Newline, '\n'),
                identifier('foo'),
                token(Lexeme.Colon, ':'),
                token(Lexeme.Integer, '1', new Int32(1)),
                token(Lexeme.Newline, '\n'),
                identifier('bar'),
                token(Lexeme.Colon, ':'),
                token(Lexeme.Integer, '2', new Int32(2)),
                token(Lexeme.Newline, '\n'),
                identifier('baz'),
                token(Lexeme.Colon, ':'),
                token(Lexeme.Integer, '3', new Int32(3)),
                token(Lexeme.Newline, '\n'),
                token(Lexeme.RightBrace, '}'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    it('allows separating properties with colons', () => {
        let { statements, errors } = Parser.parse([
            token(Lexeme.Sub, 'sub'),
            identifier('main'),
            token(Lexeme.LeftParen, '('),
            token(Lexeme.RightParen, ')'),
            token(Lexeme.Newline, '\n'),
            identifier('person'),
            token(Lexeme.Equal, '='),
            token(Lexeme.LeftBrace, '{'),
            identifier('name'),
            token(Lexeme.Colon, ':'),
            token(Lexeme.String, 'Bob', new BrsString('Bob')),
            token(Lexeme.Colon, ':'),
            token(Lexeme.Colon, ':'),
            token(Lexeme.Colon, ':'),
            token(Lexeme.Colon, ':'),
            token(Lexeme.Colon, ':'),
            identifier('age'),
            token(Lexeme.Colon, ':'),
            token(Lexeme.Integer, '50', new Int32(3)),
            token(Lexeme.RightBrace, '}'),
            token(Lexeme.Newline, '\n'),
            token(Lexeme.EndSub, 'end sub'),
            EOF
        ]);
        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('allows a mix of quoted and unquoted keys', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(Lexeme.Equal, '='),
            token(Lexeme.LeftBrace, '{'),
            token(Lexeme.Newline, '\n'),
            token(Lexeme.String, 'foo', new BrsString('foo')),
            token(Lexeme.Colon, ':'),
            token(Lexeme.Integer, '1', new Int32(1)),
            token(Lexeme.Comma, ','),
            token(Lexeme.Newline, '\n'),
            identifier('bar'),
            token(Lexeme.Colon, ':'),
            token(Lexeme.Integer, '2', new Int32(2)),
            token(Lexeme.Comma, ','),
            token(Lexeme.Newline, '\n'),
            token(Lexeme.String, 'requires-hyphens', new BrsString('requires-hyphens')),
            token(Lexeme.Colon, ':'),
            token(Lexeme.Integer, '3', new Int32(3)),
            token(Lexeme.Newline, '\n'),
            token(Lexeme.RightBrace, '}'),
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
                kind: Lexeme.Identifier,
                text: 'a',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 1 }
                }
            },
            {
                kind: Lexeme.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 1, column: 2 },
                    end: { line: 1, column: 3 }
                }
            },
            {
                kind: Lexeme.LeftBrace,
                text: '{',
                isReserved: false,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 5 }
                }
            },
            {
                kind: Lexeme.RightBrace,
                text: '}',
                isReserved: false,
                location: {
                    start: { line: 1, column: 8 },
                    end: { line: 1, column: 9 }
                }
            },
            {
                kind: Lexeme.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 1, column: 9 },
                    end: { line: 1, column: 10 }
                }
            },
            {
                kind: Lexeme.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 2, column: 0 },
                    end: { line: 2, column: 1 }
                }
            },
            {
                kind: Lexeme.Identifier,
                text: 'b',
                isReserved: false,
                location: {
                    start: { line: 3, column: 0 },
                    end: { line: 3, column: 1 }
                }
            },
            {
                kind: Lexeme.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 3, column: 2 },
                    end: { line: 3, column: 3 }
                }
            },
            {
                kind: Lexeme.LeftBrace,
                text: '{',
                isReserved: false,
                location: {
                    start: { line: 3, column: 4 },
                    end: { line: 3, column: 5 }
                }
            },
            {
                kind: Lexeme.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 4, column: 0 },
                    end: { line: 4, column: 1 }
                }
            },
            {
                kind: Lexeme.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 5, column: 0 },
                    end: { line: 5, column: 1 }
                }
            },
            {
                kind: Lexeme.RightBrace,
                text: '}',
                isReserved: false,
                location: {
                    start: { line: 6, column: 0 },
                    end: { line: 6, column: 1 }
                }
            },
            {
                kind: Lexeme.Eof,
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
