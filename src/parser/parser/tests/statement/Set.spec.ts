import { expect } from 'chai';

import { Parser } from '../..';
import { Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser indexed assignment', () => {
    describe('dotted', () => {
        it('assigns anonymous functions', () => {
            let { statements, errors } = Parser.parse([
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });

        it('assigns boolean expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.And, 'and'),
                token(TokenKind.False, 'false'),
                token(TokenKind.Newline, '\\n'),
                EOF
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });

        it('assignment operator', () => {
            let { statements, errors } = Parser.parse([
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                token(TokenKind.StarEqual, '*='),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.Newline, '\\n'),
                EOF
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });
    });

    describe('bracketed', () => {
        it('assigns anonymous functions', () => {
            let { statements, errors } = Parser.parse([
                identifier('someArray'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0', new Int32(0)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });

        it('assigns boolean expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('someArray'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0', new Int32(0)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.And, 'and'),
                token(TokenKind.False, 'false'),
                token(TokenKind.Newline, '\\n'),
                EOF
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });

        it('assignment operator', () => {
            let { statements, errors } = Parser.parse([
                identifier('someArray'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0', new Int32(0)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.StarEqual, '*='),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                EOF
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 1| arr[0] = 1
         * 2| obj.a = 5
         */
        let { statements, errors } = Parser.parse([
            {
                kind: TokenKind.IdentifierLiteral,
                text: 'arr',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 3 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.LeftSquareBracket,
                text: '[',
                isReserved: false,
                location: {
                    start: { line: 1, column: 3 },
                    end: { line: 1, column: 4 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '0',
                literal: new Int32(0),
                isReserved: false,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 5 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.RightSquareBracket,
                text: ']',
                isReserved: false,
                location: {
                    start: { line: 1, column: 5 },
                    end: { line: 1, column: 6 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 1, column: 7 },
                    end: { line: 1, column: 8 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '1',
                literal: new Int32(1),
                isReserved: false,
                location: {
                    start: { line: 1, column: 9 },
                    end: { line: 1, column: 10 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 1, column: 10 },
                    end: { line: 1, column: 11 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.IdentifierLiteral,
                text: 'obj',
                isReserved: false,
                location: {
                    start: { line: 2, column: 0 },
                    end: { line: 2, column: 3 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.Dot,
                text: '.',
                isReserved: false,
                location: {
                    start: { line: 2, column: 3 },
                    end: { line: 2, column: 4 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.IdentifierLiteral,
                text: 'a',
                isReserved: false,
                location: {
                    start: { line: 2, column: 4 },
                    end: { line: 2, column: 5 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 2, column: 6 },
                    end: { line: 2, column: 7 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '5',
                literal: new Int32(5),
                isReserved: false,
                location: {
                    start: { line: 2, column: 8 },
                    end: { line: 2, column: 9 },
                    file: 'Test.brs'
                }
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 2, column: 10 },
                    end: { line: 2, column: 11 },
                    file: 'Test.brs'
                }
            }
        ]);

        expect(errors).to.be.empty;
        expect(statements).to.be.lengthOf(2);
        expect(statements.map(s => s.location)).to.deep.equal([
            {
                start: { line: 1, column: 0 },
                end: { line: 1, column: 10 },
                file: 'Test.brs'
            },
            {
                start: { line: 2, column: 0 },
                end: { line: 2, column: 9 },
                file: 'Test.brs'
            }
        ]);
    });
});
