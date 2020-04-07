import { expect } from 'chai';

import { Parser } from '../..';
import { Lexer } from '../../../lexer';
import { AssignmentStatement, FunctionStatement as BrsFunction } from '../../Statement';

describe('parser library statements', () => {
    it('supports library statements at top of file', () => {
        const { tokens } = Lexer.scan(`
            Library "v30/bslCore.brs"
            sub main()
            end sub
        `);
        const { errors } = Parser.parse(tokens);
        expect(errors).to.be.lengthOf(0);
        //expect({ errors: errors, statements: statements }).toMatchSnapshot();
    });

    it('supports multiple library statements separated by colon', () => {
        const { tokens } = Lexer.scan(`
            Library "v30/bslCore.brs" : Library "v30/bslCore.brs"
            sub main()
            end sub
        `);
        const { errors } = Parser.parse(tokens);
        expect(errors).to.be.lengthOf(0);
        //expect({ errors: errors, statements: statements }).toMatchSnapshot();
    });

    it('adds error for library statements NOT at top of file', () => {
        const { tokens } = Lexer.scan(`
            sub main()
            end sub
            Library "v30/bslCore.brs"
        `);
        const { errors } = Parser.parse(tokens);
        expect(errors.length).to.be.greaterThan(0);
        //expect({ errors: errors, statements: statements }).toMatchSnapshot();
    });

    it('adds error for library statements inside of function body', () => {
        const { tokens } = Lexer.scan(`
            sub main()
                Library "v30/bslCore.brs"
            end sub
        `);
        const { errors } = Parser.parse(tokens);
        expect(errors).to.be.lengthOf(1);
        //expect({ errors: errors, statements: statements }).toMatchSnapshot();
    });

    it('still parses entire file after invalid library statement', () => {
        const { tokens } = Lexer.scan(`
            library cat dog mouse
            sub main()
            end sub
        `);
        const { errors } = Parser.parse(tokens);
        expect(errors.length).to.be.greaterThan(0);
        //expect({ errors: errors, statements: statements }).toMatchSnapshot();
    });

    it('does not prevent usage of `library` as varible name', () => {
        const { tokens } = Lexer.scan(`
            sub main()
                library = "Gotham City Library"
            end sub
        `);
        const { statements, errors } = Parser.parse(tokens) as any;
        //make sure the assignment is present in the function body
        let assignment = statements[0].func.body.statements[0];
        expect(errors).to.be.lengthOf(0);
        expect(assignment).to.be.instanceOf(AssignmentStatement);
        expect(assignment.name.text).to.equal('library');
        //expect({ errors: errors, statements: statements }).toMatchSnapshot();
    });

    it('does not prevent usage of `library` as object property name', () => {
        const { tokens } = Lexer.scan(`
            sub main()
                buildings = {
                    library: "Gotham City Library"
                }
            end sub
        `);
        const { statements, errors } = Parser.parse(tokens) as any;
        //make sure the assignment is present in the function body
        expect(statements[0].func.body.statements[0].value.elements[0].key.value).to.equal(
            'library'
        );
        expect(errors).to.be.lengthOf(0);
        //expect({ errors: errors, statements: statements }).toMatchSnapshot();
    });

    it('parses rest of file with ONLY the library keyword present at root level', () => {
        const { tokens } = Lexer.scan(`
            library
            sub main()
                library = "Your Library"
            end sub
        `);
        const { statements, errors } = Parser.parse(tokens);
        expect(errors).to.be.lengthOf(1);
        //function statement should still exist
        expect(statements[statements.length - 1]).to.be.instanceOf(BrsFunction);
        //expect({ errors: errors, statements: statements }).toMatchSnapshot();
    });
});
