import { expect } from '../../../chai-config.spec';

import { ParseMode, Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { ForEachStatement } from '../../Statement';
import { VariableExpression } from '../../Expression';
import util from '../../../util';

describe('parser foreach loops', () => {
    it('requires a name and target', () => {
        let { ast, diagnostics } = Parser.parse([
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
        expect(ast.statements).to.exist;

        let forEach = ast.statements[0] as any;
        expect(forEach).to.be.instanceof(ForEachStatement);

        expect(forEach.tokens.item).to.deep.include(identifier('word'));
        expect(forEach.target).to.be.instanceof(VariableExpression);
        expect(forEach.target.tokens.name).to.deep.include(identifier('lipsum'));
    });

    it('allows \'next\' to terminate loop', () => {
        let { ast, diagnostics } = Parser.parse([
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
        expect(ast.statements).to.exist;
        expect(ast.statements).to.be.length.greaterThan(0);
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
        let { ast, diagnostics } = Parser.parse([
            {
                kind: TokenKind.ForEach,
                text: 'for each',
                isReserved: true,
                location: util.createLocation(0, 0, 0, 8),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Identifier,
                text: 'a',
                isReserved: false,
                location: util.createLocation(0, 9, 0, 10),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Identifier,
                text: 'in',
                isReserved: true,
                location: util.createLocation(0, 11, 0, 13),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Identifier,
                text: 'b',
                isReserved: false,
                location: util.createLocation(0, 14, 0, 15),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                location: util.createLocation(0, 15, 0, 16),
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
                location: util.createLocation(2, 0, 2, 7),
                leadingTrivia: []
            },
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.be.lengthOf(1);
        expect(ast.statements[0].location.range).deep.include(
            Range.create(0, 0, 2, 7)
        );
    });

    it('supports optional type annotation', () => {
        let { ast, diagnostics } = Parser.parse([
            token(TokenKind.ForEach, 'for each'),
            identifier('word'),
            token(TokenKind.As, 'as'),
            identifier('String'),
            identifier('in'),
            identifier('lipsum'),
            token(TokenKind.Newline, '\n'),

            // body would go here, but it's not necessary for this test
            token(TokenKind.EndFor, 'end for'),
            token(TokenKind.Newline, '\n'),
            EOF
        ], { mode: ParseMode.BrighterScript });

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.exist;

        let forEach = ast.statements[0] as ForEachStatement;
        expect(forEach).to.be.instanceof(ForEachStatement);

        expect(forEach.tokens.item).to.deep.include(identifier('word'));
        expect(forEach.tokens.as).to.exist;
        expect(forEach.tokens.as.text).to.equal('as');
        expect(forEach.typeExpression).to.exist;
        expect(forEach.typeExpression?.getName()).to.equal('String');
        expect(forEach.target).to.be.instanceof(VariableExpression);
        expect((forEach.target as VariableExpression).tokens.name).to.deep.include(identifier('lipsum'));
    });
});
