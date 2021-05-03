import { expect } from 'chai';

import { Parser } from '../../Parser';
import { Lexer } from '../../../lexer';
import { AssignmentStatement, FunctionStatement as BrsFunction } from '../../Statement';

describe('parser library statements', () => {
    it('supports library statements at top of file', () => {
        const { tokens } = Lexer.scan(`
            Library "v30/bslCore.brs"
            sub main()
            end sub
        `);
        const { diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
    });

    it('supports multiple library statements separated by colon', () => {
        const { tokens } = Lexer.scan(`
            Library "v30/bslCore.brs" : Library "v30/bslCore.brs"
            sub main()
            end sub
        `);
        const { diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
    });

    it('still parses entire file after invalid library statement', () => {
        const { tokens } = Lexer.scan(`
            library cat dog mouse
            sub main()
            end sub
        `);
        const { diagnostics } = Parser.parse(tokens);
        expect(diagnostics.length).to.be.greaterThan(0);
    });

    it('does not prevent usage of `library` as varible name', () => {
        const { tokens } = Lexer.scan(`
            sub main()
                library = "Gotham City Library"
            end sub
        `);
        const { statements, diagnostics } = Parser.parse(tokens) as any;
        //make sure the assignment is present in the function body
        let assignment = statements[0].func.body.statements[0];
        expect(diagnostics).to.be.lengthOf(0);
        expect(assignment).to.be.instanceOf(AssignmentStatement);
        expect(assignment.tokens.name.text).to.equal('library');
    });

    it('does not prevent usage of `library` as object property name', () => {
        const { tokens } = Lexer.scan(`
            sub main()
                buildings = {
                    library: "Gotham City Library"
                }
            end sub
        `);
        const { statements, diagnostics } = Parser.parse(tokens) as any;
        //make sure the assignment is present in the function body
        expect(statements[0].func.body.statements[0].value.elements[0].keyToken.text).to.equal('library');
        expect(diagnostics).to.be.lengthOf(0);
    });

    it('parses rest of file with ONLY the library keyword present at root level', () => {
        const { tokens } = Lexer.scan(`
            library
            sub main()
                library = "Your Library"
            end sub
        `);
        const { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(1);
        //function statement should still exist
        expect(statements[statements.length - 1]).to.be.instanceOf(BrsFunction);
    });
});
