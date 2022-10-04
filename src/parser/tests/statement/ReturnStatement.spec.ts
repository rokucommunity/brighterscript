import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import type { FunctionStatement } from '../../Statement';
import { Range } from 'vscode-languageserver';

describe('parser return statements', () => {
    it('parses void returns', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.Function, 'function'),
            identifier('foo'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.Return, 'return'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.EndFunction, 'end function'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.ok;
    });

    it('parses literal returns', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.Function, 'function'),
            identifier('foo'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.Return, 'return'),
            token(TokenKind.StringLiteral, '"test"'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.EndFunction, 'end function'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.ok;
    });

    it('parses expression returns', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.Function, 'function'),
            identifier('foo'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.Return, 'return'),
            identifier('RebootSystem'),
            { kind: TokenKind.LeftParen, text: '(', range: null },
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.EndFunction, 'end function'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.ok;
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 0| function foo()
         * 1|   return 5
         * 2| end function
         */
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.Function, 'function'),
            identifier('foo'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\\n'),
            {
                kind: TokenKind.Return,
                text: 'return',
                isReserved: true,
                range: Range.create(1, 2, 1, 8)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '5',
                isReserved: false,
                range: Range.create(1, 9, 1, 10)
            },
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.EndFunction, 'end function'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect((statements[0] as FunctionStatement).func.body.statements[0]?.range).to.exist.and.to.deep.include(
            Range.create(1, 2, 1, 10)
        );
    });
});
