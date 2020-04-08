import { expect } from 'chai';

import { Parser } from '../../Parser';
import { BrsBoolean, Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

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
                kind: TokenKind.Identifier,
                text: '_false',
                isReserved: false,
                range: Range.create(0, 0, 0, 6)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(0, 7, 0, 8)
            },
            {
                kind: TokenKind.Not,
                text: 'not',
                isReserved: true,
                range: Range.create(0, 9, 0, 12)
            },
            {
                kind: TokenKind.True,
                text: 'true',
                literal: BrsBoolean.True,
                isReserved: true,
                range: Range.create(0, 13, 0, 17)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(0, 17, 0, 18)
            }
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect((statements[0] as any).value.range).to.deep.include(
            Range.create(0, 9, 0, 17)
        );
    });
});
