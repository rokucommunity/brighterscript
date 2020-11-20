import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind, Lexer } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser call expressions', () => {
    it('parses named function calls', () => {
        const { statements, diagnostics } = Parser.parse([
            identifier('RebootSystem'),
            { kind: TokenKind.LeftParen, text: '(', line: 1 },
            token(TokenKind.RightParen, ')'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('does not invalidate the rest of the file on incomplete statement', () => {
        const { tokens } = Lexer.scan(`
            sub DoThingOne()
                DoThin
            end sub
            sub DoThingTwo()
            end sub
        `);
        const { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.length.greaterThan(0);
        expect(statements).to.be.length.greaterThan(0);

        //ALL of the diagnostics should be on the `DoThin` line
        let lineNumbers = diagnostics.map(x => x.range.start.line);
        for (let lineNumber of lineNumbers) {
            expect(lineNumber).to.equal(2);
        }
    });

    it('does not invalidate the next statement on a multi-statement line', () => {
        const { tokens } = Lexer.scan(`
            sub DoThingOne()
                'missing closing paren
                DoThin(:name = "bob"
            end sub
            sub DoThingTwo()
            end sub
        `);
        const { statements, diagnostics } = Parser.parse(tokens);
        //there should only be 1 error
        expect(diagnostics).to.be.lengthOf(1);
        expect(statements).to.be.length.greaterThan(0);
        //the error should be BEFORE the `name = "bob"` statement
        expect(diagnostics[0].range.end.character).to.be.lessThan(25);
    });

    it('allows closing parentheses on separate line', () => {
        const { statements, diagnostics } = Parser.parse([
            identifier('RebootSystem'),
            { kind: TokenKind.LeftParen, text: '(', line: 1 },
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.RightParen, ')'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('accepts arguments', () => {
        const { statements, diagnostics } = Parser.parse([
            identifier('add'),
            { kind: TokenKind.LeftParen, text: '(', line: 1 },
            token(TokenKind.IntegerLiteral, '1'),
            { kind: TokenKind.Comma, text: ',', line: 1 },
            token(TokenKind.IntegerLiteral, '2'),
            token(TokenKind.RightParen, ')'),
            EOF
        ]) as any;

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        expect(statements[0].expression.args).to.be.ok;
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1   2
         *    0   4   8   2   6   0
         *  +----------------------
         * 0| foo("bar", "baz")
         */
        const { statements, diagnostics } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
                text: 'foo',
                isReserved: false,
                range: Range.create(0, 0, 0, 3)
            },
            {
                kind: TokenKind.LeftParen,
                text: '(',
                isReserved: false,
                range: Range.create(0, 3, 0, 4)
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"bar"`,
                isReserved: false,
                range: Range.create(0, 4, 0, 9)
            },
            {
                kind: TokenKind.Comma,
                text: ',',
                isReserved: false,
                range: Range.create(0, 9, 0, 10)
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"baz"`,
                isReserved: false,
                range: Range.create(0, 11, 0, 16)
            },
            {
                kind: TokenKind.RightParen,
                text: ')',
                isReserved: false,
                range: Range.create(0, 16, 0, 17)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(0, 17, 0, 18)
            }
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].range).to.deep.include(
            Range.create(0, 0, 0, 17)
        );
    });
});
