import { expect } from 'chai';

import { Parser } from '../..';
import { BrsBoolean, Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser prefix unary expressions', () => {

    it('parses unary \'not\'', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Not, 'not'),
            token(TokenKind.True, 'true', BrsBoolean.True),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('parses consecutive unary \'not\'', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.True, 'true', BrsBoolean.True),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('parses unary \'-\'', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Minus, '-'),
            token(TokenKind.IntegerLiteral, '5', new Int32(5)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('parses consecutive unary \'-\'', () => {
        let { statements, errors } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.IntegerLiteral, '5', new Int32(5)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1   2
         *    0   4   8   2   6   0
         *  +----------------------
         * 1| _false = not true
         */
        let { statements, errors } = Parser.parse(<any>[
            {
                kind: TokenKind.IdentifierLiteral,
                text: '_false',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 6 }
                }
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 1, column: 7 },
                    end: { line: 1, column: 8 }
                }
            },
            {
                kind: TokenKind.Not,
                text: 'not',
                isReserved: true,
                location: {
                    start: { line: 1, column: 9 },
                    end: { line: 1, column: 12 }
                }
            },
            {
                kind: TokenKind.True,
                text: 'true',
                literal: BrsBoolean.True,
                isReserved: true,
                location: {
                    start: { line: 1, column: 13 },
                    end: { line: 1, column: 17 }
                }
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 1, column: 17 },
                    end: { line: 1, column: 18 }
                }
            }
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect((statements[0] as any).value.location).to.deep.include({
            start: { line: 1, column: 9 },
            end: { line: 1, column: 17 }
        });
    });
});
