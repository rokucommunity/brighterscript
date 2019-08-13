import { expect } from 'chai';

import { Lexer } from '../lexer';
import { Parser } from './Parser';
import { ClassStatement } from './Statement';

describe('parser', () => {
    describe('class', () => {
        it('parses empty class', () => {
            let { tokens } = Lexer.scan(`
                class Person
                end class
            `);
            let { statements, errors } = Parser.parse(tokens, 'brighterscript');
            expect(errors).to.be.lengthOf(0);
            expect(statements[0]).instanceof(ClassStatement);
        });

        it('catches class without name', () => {
            let { tokens } = Lexer.scan(`
                class
                end class
            `);
            let { statements, errors } = Parser.parse(tokens, 'brighterscript');
            expect(errors).length.to.be.greaterThan(0);
            expect(statements[0]).instanceof(ClassStatement);
        });

        it('catches malformed class', () => {
            let { tokens } = Lexer.scan(`
                class Person
            `);
            let { statements, errors } = Parser.parse(tokens, 'brighterscript');
            expect(errors).length.to.be.greaterThan(0);
            expect(statements[0]).instanceof(ClassStatement);
        });
    });
});
