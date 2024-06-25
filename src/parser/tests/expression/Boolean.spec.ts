import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { util } from '../../../util';
import { expectZeroDiagnostics } from '../../../testHelpers.spec';
import type { AssignmentStatement } from '../../Statement';

describe('parser boolean expressions', () => {

    it('parses boolean ANDs', () => {
        let { ast, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.True, 'true'),
            token(TokenKind.And, 'and'),
            token(TokenKind.False, 'false'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.be.length.greaterThan(0);
    });

    it('parses boolean ORs', () => {
        let { ast, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.True, 'true'),
            token(TokenKind.Or, 'or'),
            token(TokenKind.False, 'false'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.be.length.greaterThan(0);
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1   2
         *    0   4   8   2   6   0
         *  +----------------------
         * 0| a = true and false
         */
        const parser = Parser.parse([
            {
                kind: TokenKind.Identifier,
                text: 'a',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 0, 0, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 2, 0, 3)
            },
            {
                kind: TokenKind.True,
                text: 'true',
                leadingTrivia: [],
                isReserved: true,
                location: util.createLocation(0, 4, 0, 8)
            },
            {
                kind: TokenKind.And,
                text: 'and',
                leadingTrivia: [],
                isReserved: true,
                location: util.createLocation(0, 9, 0, 12)
            },
            {
                kind: TokenKind.False,
                text: 'false',
                leadingTrivia: [],
                isReserved: true,
                location: util.createLocation(0, 13, 0, 18)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 18, 0, 19)
            }
        ]);

        expectZeroDiagnostics(parser);
        expect((parser.ast.statements[0] as AssignmentStatement).value.location.range).deep.include(
            Range.create(0, 4, 0, 18)
        );
    });
});
