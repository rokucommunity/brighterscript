import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { expectZeroDiagnostics } from '../../../testHelpers.spec';
import type { AssignmentStatement } from '../../Statement';
import { util } from '../../../util';

describe('parser prefix unary expressions', () => {

    it('parses unary \'not\'', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Not, 'not'),
            token(TokenKind.True, 'true'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses consecutive unary \'not\'', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.True, 'true'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses unary \'-\'', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Minus, '-'),
            token(TokenKind.IntegerLiteral, '5'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses consecutive unary \'-\'', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.IntegerLiteral, '5'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1   2
         *    0   4   8   2   6   0
         *  +----------------------
         * 1| _false = not true
         */
        let parser = Parser.parse([
            {
                kind: TokenKind.Identifier,
                text: '_false',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 0, 0, 6)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 7, 0, 8)
            },
            {
                kind: TokenKind.Not,
                text: 'not',
                leadingTrivia: [],
                isReserved: true,
                location: util.createLocation(0, 9, 0, 12)
            },
            {
                kind: TokenKind.True,
                text: 'true',
                leadingTrivia: [],
                isReserved: true,
                location: util.createLocation(0, 13, 0, 17)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 17, 0, 18)
            }
        ]);

        expectZeroDiagnostics(parser);
        expect((parser.ast.statements[0] as AssignmentStatement).value.location.range).to.deep.include(
            Range.create(0, 9, 0, 17)
        );
    });
});
