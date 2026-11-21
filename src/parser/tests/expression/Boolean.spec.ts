import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import type { AssignmentStatement } from '../../Statement';
import type { BinaryExpression, VariableExpression } from '../../Expression';

describe('parser boolean expressions', () => {

    it('parses boolean ANDs', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.True, 'true'),
            token(TokenKind.And, 'and'),
            token(TokenKind.False, 'false'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses boolean ORs', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.True, 'true'),
            token(TokenKind.Or, 'or'),
            token(TokenKind.False, 'false'),
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
         * 0| a = true and false
         */
        let { statements, diagnostics } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
                text: 'a',
                isReserved: false,
                range: Range.create(0, 0, 0, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(0, 2, 0, 3)
            },
            {
                kind: TokenKind.True,
                text: 'true',
                isReserved: true,
                range: Range.create(0, 4, 0, 8)
            },
            {
                kind: TokenKind.And,
                text: 'and',
                isReserved: true,
                range: Range.create(0, 9, 0, 12)
            },
            {
                kind: TokenKind.False,
                text: 'false',
                isReserved: true,
                range: Range.create(0, 13, 0, 18)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(0, 18, 0, 19)
            }
        ]) as any;

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].value.range).deep.include(
            Range.create(0, 4, 0, 18)
        );
    });

    describe('precedence', () => {
        function stringify(expr: any): string {
            if (expr.operator) {
                return `(${stringify(expr.left)} ${expr.operator.text} ${stringify(expr.right)})`;
            }
            return (expr as VariableExpression).name.text;
        }

        function parseValue(text: string) {
            const { statements, diagnostics } = Parser.parse(text);
            expect(diagnostics).to.be.lengthOf(0);
            return (statements[0] as AssignmentStatement).value as BinaryExpression;
        }

        it('binds AND tighter than OR when OR comes first', () => {
            const value = parseValue('x = a or b and c');
            expect(value.operator.kind).to.equal(TokenKind.Or);
            expect(stringify(value)).to.equal('(a or (b and c))');
        });

        it('binds AND tighter than OR when AND comes first', () => {
            const value = parseValue('x = a and b or c');
            expect(value.operator.kind).to.equal(TokenKind.Or);
            expect(stringify(value)).to.equal('((a and b) or c)');
        });

        it('binds AND tighter than OR in longer chains', () => {
            expect(
                stringify(parseValue('x = a or b and c or d and e'))
            ).to.equal('((a or (b and c)) or (d and e))');
        });

        it('keeps AND left-associative', () => {
            expect(stringify(parseValue('x = a and b and c'))).to.equal('((a and b) and c)');
        });

        it('keeps OR left-associative', () => {
            expect(stringify(parseValue('x = a or b or c'))).to.equal('((a or b) or c)');
        });
    });
});
