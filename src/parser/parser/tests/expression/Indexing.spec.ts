import { expect } from 'chai';

import { Parser } from '../..';
import { Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser indexing', () => {
    describe('one level', () => {
        it('dotted', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            //expect(statements).toMatchSnapshot();
        });

        it('bracketed', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            //expect(statements).toMatchSnapshot();
        });

        it('location tracking', () => {
            /**
             *    0   0   0   1
             *    0   4   8   2
             *  +--------------
             * 1| a = foo.bar
             * 2| b = foo[2]
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
                    kind: TokenKind.IdentifierLiteral,
                    text: 'foo',
                    isReserved: false,
                    location: {
                        start: { line: 1, column: 4 },
                        end: { line: 1, column: 7 }
                    }
                },
                {
                    kind: TokenKind.Dot,
                    text: '.',
                    isReserved: false,
                    location: {
                        start: { line: 1, column: 7 },
                        end: { line: 1, column: 8 }
                    }
                },
                {
                    kind: TokenKind.IdentifierLiteral,
                    text: 'bar',
                    isReserved: false,
                    location: {
                        start: { line: 1, column: 8 },
                        end: { line: 1, column: 11 }
                    }
                },
                {
                    kind: TokenKind.Newline,
                    text: '\n',
                    isReserved: false,
                    location: {
                        start: { line: 1, column: 11 },
                        end: { line: 1, column: 12 }
                    }
                },
                {
                    kind: TokenKind.IdentifierLiteral,
                    text: 'b',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 0 },
                        end: { line: 2, column: 1 }
                    }
                },
                {
                    kind: TokenKind.Equal,
                    text: '=',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 2 },
                        end: { line: 2, column: 3 }
                    }
                },
                {
                    kind: TokenKind.IdentifierLiteral,
                    text: 'bar',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 4 },
                        end: { line: 2, column: 7 }
                    }
                },
                {
                    kind: TokenKind.LeftSquareBracket,
                    text: '[',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 7 },
                        end: { line: 2, column: 8 }
                    }
                },
                {
                    kind: TokenKind.IntegerLiteral,
                    text: '2',
                    literal: new Int32(2),
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 8 },
                        end: { line: 2, column: 9 }
                    }
                },
                {
                    kind: TokenKind.RightSquareBracket,
                    text: ']',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 9 },
                        end: { line: 2, column: 10 }
                    }
                },
                {
                    kind: TokenKind.Eof,
                    text: '\0',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 10 },
                        end: { line: 2, column: 11 }
                    }
                }
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.lengthOf(2);
            expect(statements.map(s => (s as any).value.location)).to.deep.equal([
                {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 11 },
                    file: undefined
                },
                {
                    start: { line: 2, column: 4 },
                    end: { line: 2, column: 10 },
                    file: undefined
                }
            ]);
        });
    });

    describe('multi-level', () => {
        it('dotted', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('bracketed', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0', new Int32(0)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '6', new Int32(6)),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('mixed', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0', new Int32(0)),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.Dot, '.'),
                identifier('baz'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });
});
