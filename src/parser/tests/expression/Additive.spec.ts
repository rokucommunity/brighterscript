import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { util } from '../../../util';
import { expectZeroDiagnostics } from '../../../testHelpers.spec';
import type { AssignmentStatement } from '../../Statement';

describe('parser additive expressions', () => {
    it('parses left-associative addition chains', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '1'),
            token(TokenKind.Plus, '+'),
            token(TokenKind.IntegerLiteral, '2'),
            token(TokenKind.Plus, '+'),
            token(TokenKind.IntegerLiteral, '3'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses left-associative subtraction chains', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '1'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.IntegerLiteral, '2'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.IntegerLiteral, '3'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('tracks starting and ending locations', () => {
        // 0   0   0   1
        // 0   4   8   2
        // ^^ columns ^^
        //
        // _ = 1 + 2 + 3
        const parser = Parser.parse([
            {
                kind: TokenKind.Identifier,
                text: '_',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 0, 0, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 2, 0, 2)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '1',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 4, 0, 5)
            },
            {
                kind: TokenKind.Plus,
                text: '+',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 6, 0, 7)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '2',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 8, 0, 9)
            },
            {
                kind: TokenKind.Plus,
                text: '+',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 10, 0, 11)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '3',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 12, 0, 13)
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
        expect((parser.ast.statements[0] as AssignmentStatement).value.location.range).to.deep.include(
            Range.create(0, 4, 0, 13)
        );
    });
});
