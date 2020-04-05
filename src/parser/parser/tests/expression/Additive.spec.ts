import { expect } from 'chai';

import { Parser } from '../..';
import { Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser additive expressions', () => {
    it('parses left-associative addition chains', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Integer, '1', new Int32(1)),
            token(TokenKind.Plus, '+'),
            token(TokenKind.Integer, '2', new Int32(2)),
            token(TokenKind.Plus, '+'),
            token(TokenKind.Integer, '3', new Int32(3)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('parses left-associative subtraction chains', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Integer, '1', new Int32(1)),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Integer, '2', new Int32(2)),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Integer, '3', new Int32(3)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('tracks starting and ending locations', () => {
        // 0   0   0   1
        // 0   4   8   2
        // ^^ columns ^^
        //
        // _ = 1 + 2 + 3
        let { statements, errors } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
                text: '_',
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
                    end: { line: 1, column: 2 }
                }
            },
            {
                kind: TokenKind.Integer,
                text: '1',
                isReserved: false,
                literal: new Int32(1),
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 5 }
                }
            },
            {
                kind: TokenKind.Plus,
                text: '+',
                isReserved: false,
                location: {
                    start: { line: 1, column: 6 },
                    end: { line: 1, column: 7 }
                }
            },
            {
                kind: TokenKind.Integer,
                text: '2',
                isReserved: false,
                literal: new Int32(2),
                location: {
                    start: { line: 1, column: 8 },
                    end: { line: 1, column: 9 }
                }
            },
            {
                kind: TokenKind.Plus,
                text: '+',
                isReserved: false,
                location: {
                    start: { line: 1, column: 10 },
                    end: { line: 1, column: 11 }
                }
            },
            {
                kind: TokenKind.Integer,
                text: '3',
                isReserved: false,
                literal: new Int32(3),
                location: {
                    start: { line: 1, column: 12 },
                    end: { line: 1, column: 13 }
                }
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 1, column: 13 },
                    end: { line: 1, column: 14 }
                }
            }
        ]) as any;

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].value.location).to.deep.include({
            start: { line: 1, column: 4 },
            end: { line: 1, column: 13 }
        });
    });
});
