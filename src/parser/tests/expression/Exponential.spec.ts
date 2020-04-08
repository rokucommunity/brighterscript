import { expect } from 'chai';

import { Parser } from '../../parser';
import { Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser', () => {
    describe('exponential expressions', () => {
        it('parses exponential operators', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Caret, '^'),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses repeated exponential operators as left-associative', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Caret, '^'),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.Caret, '^'),
                token(TokenKind.IntegerLiteral, '4', new Int32(4)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });
});
