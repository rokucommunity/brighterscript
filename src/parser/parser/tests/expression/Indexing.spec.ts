import { expect } from 'chai';

import { Parser } from '../..';
import { Int32 } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser indexing', () => {
    describe('one level', () => {
        it('dotted', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                identifier('foo'),
                token(Lexeme.Dot, '.'),
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
                token(Lexeme.Equal, '='),
                identifier('foo'),
                token(Lexeme.LeftSquare, '['),
                token(Lexeme.Integer, '2', new Int32(2)),
                token(Lexeme.RightSquare, ']'),
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
                    kind: Lexeme.Identifier,
                    text: 'foo',
                    isReserved: false,
                    location: {
                        start: { line: 1, column: 4 },
                        end: { line: 1, column: 7 }
                    }
                },
                {
                    kind: Lexeme.Dot,
                    text: '.',
                    isReserved: false,
                    location: {
                        start: { line: 1, column: 7 },
                        end: { line: 1, column: 8 }
                    }
                },
                {
                    kind: Lexeme.Identifier,
                    text: 'bar',
                    isReserved: false,
                    location: {
                        start: { line: 1, column: 8 },
                        end: { line: 1, column: 11 }
                    }
                },
                {
                    kind: Lexeme.Newline,
                    text: '\n',
                    isReserved: false,
                    location: {
                        start: { line: 1, column: 11 },
                        end: { line: 1, column: 12 }
                    }
                },
                {
                    kind: Lexeme.Identifier,
                    text: 'b',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 0 },
                        end: { line: 2, column: 1 }
                    }
                },
                {
                    kind: Lexeme.Equal,
                    text: '=',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 2 },
                        end: { line: 2, column: 3 }
                    }
                },
                {
                    kind: Lexeme.Identifier,
                    text: 'bar',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 4 },
                        end: { line: 2, column: 7 }
                    }
                },
                {
                    kind: Lexeme.LeftSquare,
                    text: '[',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 7 },
                        end: { line: 2, column: 8 }
                    }
                },
                {
                    kind: Lexeme.Integer,
                    text: '2',
                    literal: new Int32(2),
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 8 },
                        end: { line: 2, column: 9 }
                    }
                },
                {
                    kind: Lexeme.RightSquare,
                    text: ']',
                    isReserved: false,
                    location: {
                        start: { line: 2, column: 9 },
                        end: { line: 2, column: 10 }
                    }
                },
                {
                    kind: Lexeme.Eof,
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
                token(Lexeme.Equal, '='),
                identifier('foo'),
                token(Lexeme.Dot, '.'),
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
                token(Lexeme.Equal, '='),
                identifier('foo'),
                token(Lexeme.LeftSquare, '['),
                token(Lexeme.Integer, '2', new Int32(2)),
                token(Lexeme.RightSquare, ']'),
                token(Lexeme.LeftSquare, '['),
                token(Lexeme.Integer, '0', new Int32(0)),
                token(Lexeme.RightSquare, ']'),
                token(Lexeme.LeftSquare, '['),
                token(Lexeme.Integer, '6', new Int32(6)),
                token(Lexeme.RightSquare, ']'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('mixed', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                identifier('foo'),
                token(Lexeme.Dot, '.'),
                identifier('bar'),
                token(Lexeme.LeftSquare, '['),
                token(Lexeme.Integer, '0', new Int32(0)),
                token(Lexeme.RightSquare, ']'),
                token(Lexeme.Dot, '.'),
                identifier('baz'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });
});
