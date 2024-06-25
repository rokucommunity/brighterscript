import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser', () => {

    describe('relational expressions', () => {
        it('parses less-than expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.Less, '<'),
                token(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses less-than-or-equal-to expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.LessEqual, '<='),
                token(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);

        });

        it('parses greater-than expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.Greater, '>'),
                token(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);

        });

        it('parses greater-than-or-equal-to expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.GreaterEqual, '>='),
                token(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses equality expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);

        });

        it('parses inequality expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.LessGreater, '<>'),
                token(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });
    });
});
