import { expect } from 'chai';
import type { ForStatement, FunctionStatement } from '../..';
import { ContinueStatement } from '../..';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectZeroDiagnostics } from '../../../testHelpers.spec';
import { Parser } from '../../Parser';

describe.only('parser continue statements', () => {
    it('parses standalone statement properly', () => {
        let parser = Parser.parse(`
            sub main()
                for i = 0 to 10
                    continue
                end for
            end sub
        `);
        expectZeroDiagnostics(parser);
        const stmt = ((parser.ast.statements[0] as FunctionStatement).func.body.statements[0] as ForStatement).body.statements[0] as ContinueStatement;
        expect(stmt).to.be.instanceof(ContinueStatement);
    });

    it('detects `continue` used outside of a loop', () => {
        let parser = Parser.parse(`
            sub main()
                continue
            end sub
        `);
        expect(parser.diagnostics[0]?.message).to.eql(
            DiagnosticMessages.illegalContinueStatement().message
        );
    });
});
