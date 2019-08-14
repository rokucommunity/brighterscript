import { expect } from 'chai';

import { diagnosticMessages } from '../../DiagnosticMessages';
import { Lexeme, Lexer } from '../lexer';
import { Parser } from './Parser';
import { ClassFieldStatement, ClassStatement } from './Statement';

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

        describe('fields', () => {
            it('identifies perfect syntax', () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        public firstName as string
                    end class
                `);
                let { statements, errors } = Parser.parse(tokens, 'brighterscript');
                expect(errors).to.be.empty;
                expect(statements[0]).instanceof(ClassStatement);
                let field = (statements[0] as ClassStatement).members[0] as ClassFieldStatement;
                expect(field.accessModifier.kind).to.equal(Lexeme.Public);
                expect(field.name.text).to.equal('firstName');
                expect(field.as.text).to.equal('as');
                expect(field.type.text).to.equal('string');
            });

            it('detects missing access modifier', () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        firstName as string
                    end class
                `);
                let { errors } = Parser.parse(tokens, 'brighterscript');
                expect(errors).to.have.lengthOf(1);
                expect(errors[0].code).to.equal(diagnosticMessages.Missing_field_access_modifier_1016('').code);
            });

            it('detects missing trailing type', () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        public firstName
                    end class
                `);
                let { errors } = Parser.parse(tokens, 'brighterscript');
                expect(errors).to.have.lengthOf(1);
                expect(errors[0].code).to.equal(diagnosticMessages.Missing_class_field_type_1019().code);
            });
        });
    });
});
