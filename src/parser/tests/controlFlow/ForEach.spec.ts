import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { ForEachStatement } from '../../Statement';
import { VariableExpression } from '../../Expression';

describe('parser foreach loops', () => {
    it('requires a name and target', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.ForEach, 'for each'),
            identifier('word'),
            identifier('in'),
            identifier('lipsum'),
            token(TokenKind.Newline, '\n'),

            // body would go here, but it's not necessary for this test
            token(TokenKind.EndFor, 'end for'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;

        let forEach = statements[0] as any;
        expect(forEach).to.be.instanceof(ForEachStatement);

        expect(forEach.tokens.item).to.deep.include(identifier('word'));
        expect(forEach.target).to.be.instanceof(VariableExpression);
        expect(forEach.target.tokens.name).to.deep.include(identifier('lipsum'));
    });

    it('allows \'next\' to terminate loop', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.ForEach, 'for each'),
            identifier('word'),
            identifier('in'),
            identifier('lipsum'),
            token(TokenKind.Newline, '\n'),

            // body would go here, but it's not necessary for this test
            token(TokenKind.Next, 'next'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).to.be.length.greaterThan(0);
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 0| for each a in b
         * 1|   Rnd(a)
         * 2| end for
         */
        let { statements, diagnostics } = Parser.parse([
            {
                kind: TokenKind.ForEach,
                text: 'for each',
                isReserved: true,
                range: Range.create(0, 0, 0, 8),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Identifier,
                text: 'a',
                isReserved: false,
                range: Range.create(0, 9, 0, 10),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Identifier,
                text: 'in',
                isReserved: true,
                range: Range.create(0, 11, 0, 13),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Identifier,
                text: 'b',
                isReserved: false,
                range: Range.create(0, 14, 0, 15),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(0, 15, 0, 16),
                leadingTrivia: []
            },
            // loop body isn't significant for location tracking, so helper functions are safe
            identifier('Rnd'),
            token(TokenKind.LeftParen, '('),
            identifier('a'),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\n'),
            {
                kind: TokenKind.EndFor,
                text: 'end for',
                isReserved: false,
                range: Range.create(2, 0, 2, 7),
                leadingTrivia: []
            },
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].range).deep.include(
            Range.create(0, 0, 2, 7)
        );
    });
});
