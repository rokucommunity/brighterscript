import { expect } from '../../../chai-config.spec';
import type { TryCatchStatement, ThrowStatement } from '../../Statement';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { LiteralExpression } from '../../Expression';
import { Parser } from '../../Parser';

describe('parser ThrowStatement', () => {
    it('parses properly', () => {
        const parser = Parser.parse(`
            try
                throw "some message"
            catch
            end try
        `);
        const throwStatement = (parser.ast.statements[0] as TryCatchStatement).tryBranch!.statements[0] as ThrowStatement;
        //the statement should still exist and have null expression
        expect(throwStatement).to.exist;
        expect(throwStatement.expression).to.be.instanceof(LiteralExpression);
    });

    it('flags missing exception expression', () => {
        const parser = Parser.parse(`
            try
                throw
            catch
            end try
        `);
        expect(parser.diagnostics[0]?.message).to.eql(DiagnosticMessages.missingExceptionExpressionAfterThrowKeyword().message);
        const throwStatement = (parser.ast.statements[0] as TryCatchStatement).tryBranch!.statements[0] as ThrowStatement;
        //the statement should still exist and have null expression
        expect(throwStatement).to.exist;
        expect(throwStatement.expression).to.not.exist;

    });
});
