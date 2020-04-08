import { expect } from 'chai';

import { Parser } from '../../parser';
import { BrsString } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, token } from '../Parser.spec';

describe('parser print statements', () => {
    it('parses singular print statements', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.Print),
            token(TokenKind.StringLiteral, 'Hello, world'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('supports empty print', () => {
        let { statements, errors } = Parser.parse([token(TokenKind.Print), EOF]);
        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('parses print lists with no separator', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.Print),
            token(TokenKind.StringLiteral, 'Foo', new BrsString('Foo')),
            token(TokenKind.StringLiteral, 'bar', new BrsString('bar')),
            token(TokenKind.StringLiteral, 'baz', new BrsString('baz')),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('parses print lists with separators', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.Print),
            token(TokenKind.StringLiteral, 'Foo', new BrsString('Foo')),
            token(TokenKind.Semicolon),
            token(TokenKind.StringLiteral, 'bar', new BrsString('bar')),
            token(TokenKind.Semicolon),
            token(TokenKind.StringLiteral, 'baz', new BrsString('baz')),
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
         * 1| print "foo"
         */
        let { statements, errors } = Parser.parse([
            {
                kind: TokenKind.Print,
                text: 'print',
                isReserved: true,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 5 }
                }
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"foo"`,
                literal: new BrsString('foo'),
                isReserved: false,
                location: {
                    start: { line: 1, column: 6 },
                    end: { line: 1, column: 11 }
                }
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 1, column: 11 },
                    end: { line: 1, column: 12 }
                }
            }
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].location).to.deep.include({
            start: { line: 1, column: 0 },
            end: { line: 1, column: 11 }
        });
    });
});
