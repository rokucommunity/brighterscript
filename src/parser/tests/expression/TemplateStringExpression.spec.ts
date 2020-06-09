/* eslint-disable @typescript-eslint/no-for-in-array */
import { expect } from 'chai';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Lexer } from '../../../lexer';
import { Parser, ParseMode } from '../../Parser';
import { AssignmentStatement } from '../../Statement';

describe('parser template String', () => {
    it('throws exception when used in brightscript scope', () => {
        let { tokens } = Lexer.scan(`a = \`hello \=world`);
        let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });
        expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
    });

    describe('in assignment', () => {
        it(`simple case`, () => {
            let { tokens } = Lexer.scan(`a = \`hello      world\``);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`complex case`, () => {

            let { tokens } = Lexer.scan(`a = \`hello \${"world"}!
              I am a \${"template" + "\`string\`"} 
              and I am very \${["pleased"][0]} to meet you \${m.top.getChildCount()}
              the end. 
              goodnight`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });
    });
});

describe('transpilation', () => {
    it('transpiles simple case', () => {
        let { tokens } = Lexer.scan(`person ?? "zombie"`);
        let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });

        expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
    });

    it('generates scope for complex case', () => {
        let { tokens } = Lexer.scan(`m.a + m.b(m.a, var1) ?? var2.name + process([var3, var4])`);
        let { statements } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        (statements[0] as AssignmentStatement).value.transpile(null);
    });
});
