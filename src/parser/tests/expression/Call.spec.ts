import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { Lexer } from '../../../lexer/Lexer';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import type { ExpressionStatement, FunctionStatement } from '../../Statement';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectDiagnostics, expectDiagnosticsIncludes } from '../../../testHelpers.spec';
import { isAssignmentStatement, isCallExpression, isDottedGetExpression, isDottedSetStatement, isExpressionStatement, isIndexedGetExpression, isReturnStatement } from '../../../astUtils/reflection';

describe('parser call expressions', () => {
    it('parses named function calls', () => {
        const { statements, diagnostics } = Parser.parse([
            identifier('RebootSystem'),
            { kind: TokenKind.LeftParen, text: '(', range: null as any, leadingTrivia: [] },
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
        expectDiagnostics(diagnostics, [
            DiagnosticMessages.unexpectedToken(':'),
            DiagnosticMessages.expectedRightParenAfterFunctionCallArguments()
        ]);
        expect(statements).to.be.length.greaterThan(0);
        //the error should be BEFORE the `name = "bob"` statement
        expect(diagnostics[0].range.end.character).to.be.lessThan(25);
    });

    it('allows closing parentheses on separate line', () => {
        const { statements, diagnostics } = Parser.parse([
            identifier('RebootSystem'),
            { kind: TokenKind.LeftParen, text: '(', range: null as any, leadingTrivia: [] },
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.RightParen, ')'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('includes partial statements and expressions', () => {
        const { statements, diagnostics } = Parser.parse(`
            function processData(data)
                data.foo.bar. = "hello"
                data.foo.func().
                result = data.foo.
                return result.
            end function
        `);

        expect(diagnostics).to.be.lengthOf(4);
        expectDiagnostics(diagnostics, [
            DiagnosticMessages.expectedPropertyNameAfterPeriod(),
            DiagnosticMessages.expectedPropertyNameAfterPeriod(),
            DiagnosticMessages.expectedPropertyNameAfterPeriod(),
            DiagnosticMessages.expectedPropertyNameAfterPeriod()
        ]);
        expect(statements).to.be.lengthOf(1);
        const bodyStatements = (statements[0] as FunctionStatement).func.body.statements;
        expect(bodyStatements).to.be.lengthOf(4); // each line is a statement

        // first should be: data.foo.bar = "hello"
        expect(isDottedSetStatement(bodyStatements[0])).to.be.true;
        const setStmt = bodyStatements[0] as any;
        expect(setStmt.tokens.name.text).to.equal('bar');
        expect(setStmt.obj.tokens.name.text).to.equal('foo');
        expect(setStmt.obj.obj.tokens.name.text).to.equal('data');
        expect(setStmt.value.token.text).to.equal('"hello"');

        // 2nd should be: data.foo.func()
        expect(isExpressionStatement(bodyStatements[1])).to.be.true;
        expect(isCallExpression((bodyStatements[1] as any).expression)).to.be.true;
        const callExpr = (bodyStatements[1] as any).expression;
        expect(callExpr.callee.tokens.name.text).to.be.equal('func');
        expect(callExpr.callee.obj.tokens.name.text).to.be.equal('foo');
        expect(callExpr.callee.obj.obj.tokens.name.text).to.be.equal('data');

        // 3rd should be: result = data.foo
        expect(isAssignmentStatement(bodyStatements[2])).to.be.true;
        const assignStmt = (bodyStatements[2] as any);
        expect(assignStmt.tokens.name.text).to.equal('result');
        expect(assignStmt.value.tokens.name.text).to.equal('foo');

        // 4th should be: return result
        expect(isReturnStatement(bodyStatements[3])).to.be.true;
        const returnStmt = (bodyStatements[3] as any);
        expect(returnStmt.value.tokens.name.text).to.equal('result');
    });

    it('accepts arguments', () => {
        const { statements, diagnostics } = Parser.parse([
            identifier('add'),
            { kind: TokenKind.LeftParen, text: '(', range: null as any, leadingTrivia: [] },
            token(TokenKind.IntegerLiteral, '1'),
            { kind: TokenKind.Comma, text: ',', range: null as any, leadingTrivia: [] },
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

    describe('unfinished', () => {
        it('continues parsing inside unfinished function calls', () => {
            const { statements, diagnostics } = Parser.parse(`
                sub doSomething(data)
                    otherFunc(data.foo, data.bar[0]
                end sub
            `);

            expect(diagnostics).to.be.lengthOf(2);
            expectDiagnostics(diagnostics, [
                DiagnosticMessages.expectedRightParenAfterFunctionCallArguments(),
                DiagnosticMessages.expectedNewlineOrColon()
            ]);
            expect(statements).to.be.lengthOf(1);
            const bodyStatements = (statements[0] as FunctionStatement).func.body.statements;
            expect(bodyStatements).to.be.lengthOf(1);

            // Function statement should still be parsed
            expect(isExpressionStatement(bodyStatements[0])).to.be.true;
            expect(isCallExpression((bodyStatements[0] as ExpressionStatement).expression)).to.be.true;
            const callExpr = (bodyStatements[0] as ExpressionStatement).expression as any;
            expect(callExpr.callee.tokens.name.text).to.equal('otherFunc');

            // args should still be parsed, as well!
            expect(callExpr.args).to.be.lengthOf(2);
            expect(isDottedGetExpression(callExpr.args[0])).to.be.true;
            expect(isIndexedGetExpression(callExpr.args[1])).to.be.true;
        });

        it('gets correct diagnostic for missing close paren without args', () => {
            let { diagnostics } = Parser.parse(`
                sub process()
                    someFunc(
                end sub
            `);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.expectedRightParenAfterFunctionCallArguments()
            ]);
        });

        it('gets correct diagnostic for missing close paren with args', () => {
            let { diagnostics } = Parser.parse(`
                sub process()
                    someFunc("hello"
                end sub
            `);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.expectedRightParenAfterFunctionCallArguments()
            ]);
        });

        it('gets correct diagnostic for missing close paren with invalid expression as arg', () => {
            let { diagnostics, statements } = Parser.parse(`
                sub process(data)
                    someFunc(data.name. ,
                end sub
            `);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.expectedRightParenAfterFunctionCallArguments()
            ]);
            expect(statements).to.be.lengthOf(1);
            const bodyStatements = (statements[0] as FunctionStatement).func.body.statements;
            expect(bodyStatements).to.be.lengthOf(1);
        });
    });

});
