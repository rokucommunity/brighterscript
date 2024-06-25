import { expect } from '../../../chai-config.spec';
import { Parser } from '../../Parser';
import { TryCatchStatement } from '../../Statement';
import { isFunctionExpression } from '../../../astUtils/reflection';
import type { FunctionExpression } from '../../Expression';
import { expectDiagnosticsIncludes } from '../../../testHelpers.spec';
import { DiagnosticMessages } from '../../../DiagnosticMessages';

describe('parser try/catch', () => {
    it('can parse try catch statements', () => {
        const parser = Parser.parse(`
            sub new()
                try
                    print "hello"
                catch e
                    print "error"
                end try
            end sub
        `);
        expect(parser.diagnostics[0]?.message).not.to.exist;

        const functionExpressions = parser.ast.findChildren<FunctionExpression>(isFunctionExpression);
        const stmt = functionExpressions[0].body.statements[0] as TryCatchStatement;
        expect(stmt).to.be.instanceof(TryCatchStatement);
        expect(stmt.tokens.try?.text).to.eql('try');
        expect(stmt.tryBranch).to.exist.and.ownProperty('statements').to.be.lengthOf(1);
        expect(stmt.catchStatement).to.exist;
        const cstmt = stmt.catchStatement;
        expect(cstmt!.tokens.catch?.text).to.eql('catch');
        expect(cstmt!.tokens.exceptionVariable!.text).to.eql('e');
        expect(cstmt!.catchBranch).to.exist.and.ownProperty('statements').to.be.lengthOf(1);
        expect(stmt.tokens.endTry?.text).to.eql('end try');
    });

    it('supports various configurations of try-catch', () => {
        function expectNoParseErrors(text: string) {
            const parser = Parser.parse(`
                sub main()
                    ${text}
                end sub
            `);
            expect(parser.diagnostics[0]?.message).not.to.exist;
        }

        expectNoParseErrors(`
            try : print a.b.c : catch e : print "error" :  end try
        `);

        //multiple statements
        expectNoParseErrors(`
            try : print "one" : print "two" : catch e : print "error" : end try
        `);

        expectNoParseErrors(`
            try : print a.b.c
            catch e : print "error" :  end try
        `);

        expectNoParseErrors(`
            try
                print a.b.c
            catch e : print "error" :  end try
        `);

        expectNoParseErrors(`
            try
                print a.b.c
            catch e
                print "error" :  end try
        `);

        expectNoParseErrors(`
            try: print a.b.c
            catch e
                print "error" :  end try
        `);

        expectNoParseErrors(`
            try: print a.b.c :  catch e
            print "error" :  end try
        `);

        expectNoParseErrors(`
            try: print a.b.c :  catch e : print "error"
            end try
        `);

        expectNoParseErrors(`
            try
            : print a.b.c : catch e : print "error" : end try
        `);

        expectNoParseErrors(`
            try : print a.b.c
            : catch e : print "error" : end try
        `);

        expectNoParseErrors(`
            try : print a.b.c
            : catch e
            : print "error" : end try
        `);

        expectNoParseErrors(`
            try
            : print a.b.c
            : catch e
            : print "error"
            : end try
        `);
    });

    it('recovers gracefully with syntax errors', () => {
        const parser = Parser.parse(`
            sub new()
                try
                    print "hello"
                catch e
                    print "error"
                end try
            end sub
        `);
        expect(parser.diagnostics[0]?.message).not.to.exist;
    });

    it('recovers from missing end-try when reaching function boundary', () => {
        const parser = Parser.parse(`
            sub new()
                try
                    print "hello"
                catch e
                    print "error"
            end sub
        `);
        expect(parser.diagnostics).to.be.lengthOf(1);
    });

    it('recovers from missing catch', () => {
        const parser = Parser.parse(`
            sub new()
                try
                    print "hello"
                    print "error"
                end try
            end sub
        `);
        expectDiagnosticsIncludes(parser, [
            DiagnosticMessages.expectedCatchBlockInTryCatch().message
        ]);
    });

    it('recovers from missing catch and end-try when reaching function boundary', () => {
        const parser = Parser.parse(`
            sub new()
                try
                    print "hello"
                    print "error"
            end sub
        `);
        expectDiagnosticsIncludes(parser, [
            DiagnosticMessages.expectedCatchBlockInTryCatch().message,
            DiagnosticMessages.expectedEndTryToTerminateTryCatch().message
        ]);
    });
});
