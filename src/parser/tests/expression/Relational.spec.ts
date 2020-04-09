import { expect } from 'chai';

import { Parser } from '../../Parser';
import { Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser', () => {

    describe('relational expressions', () => {
        it('parses less-than expressions', () => {
            let { statements, diagnostics: errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.Less, '<'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses less-than-or-equal-to expressions', () => {
            let { statements, diagnostics: errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.LessEqual, '<='),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses greater-than expressions', () => {
            let { statements, diagnostics: errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.Greater, '>'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses greater-than-or-equal-to expressions', () => {
            let { statements, diagnostics: errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.GreaterEqual, '>='),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses equality expressions', () => {
            let { statements, diagnostics: errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses inequality expressions', () => {
            let { statements, diagnostics: errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.LessGreater, '<>'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });
});
