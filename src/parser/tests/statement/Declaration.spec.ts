import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { expectZeroDiagnostics } from '../../../testHelpers.spec';
import { util } from '../../../util';

describe('parser variable declarations', () => {
    it('allows newlines before assignments', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.Newline),
            token(TokenKind.Newline),
            token(TokenKind.Newline),
            identifier('hasNewlines'),
            token(TokenKind.Equal),
            token(TokenKind.True),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('allows newlines after assignments', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('hasNewlines'),
            token(TokenKind.Equal),
            token(TokenKind.True),
            token(TokenKind.Newline),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('parses literal value assignments', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('foo'),
            token(TokenKind.Equal),
            token(TokenKind.IntegerLiteral, '5'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('parses evaluated value assignments', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('bar'),
            token(TokenKind.Equal),
            token(TokenKind.IntegerLiteral, '5'),
            token(TokenKind.Caret),
            token(TokenKind.IntegerLiteral, '3'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('parses variable aliasing', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('baz'),
            token(TokenKind.Equal),
            identifier('foo'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 0| foo = invalid
         */
        const parser = Parser.parse([
            {
                kind: TokenKind.Identifier,
                text: 'foo',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 0, 0, 3)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 4, 0, 5)
            },
            {
                kind: TokenKind.Invalid,
                text: 'invalid',
                leadingTrivia: [],
                isReserved: true,
                location: util.createLocation(0, 6, 0, 13)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 13, 0, 14)
            }
        ]);

        expectZeroDiagnostics(parser);
        expect(parser.ast.statements[0].location?.range).to.deep.include(
            Range.create(0, 0, 0, 13)
        );
    });
});
