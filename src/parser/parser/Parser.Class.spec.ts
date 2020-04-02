import { expect } from 'chai';
import { diagnosticMessages } from '../../DiagnosticMessages';
import { Lexeme, Lexer } from '../lexer';
import { Parser } from './Parser';
import { ClassFieldStatement, ClassStatement } from './Statement';

describe('parser', () => {
    describe('class', () => {
        it('throws exception when used in brightscript context', () => {
            let { tokens } = Lexer.scan(`
                class Person
                end class
            `);
            let { errors } = Parser.parse(tokens, 'brightscript');
            expect(errors[0].code).to.equal(diagnosticMessages.Bs_feature_not_supported_in_brs_files_1019('').code);

        });
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

            it('can be solely an identifier', () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        firstName
                    end class
                `);
                let { statements, errors } = Parser.parse(tokens, 'brighterscript');
                expect(errors).to.be.lengthOf(0);
                let cls = statements[0] as ClassStatement;
                expect(cls.fields[0].name.text).to.equal('firstName');
            });

            it('malformed field does not impact leading and trailing fields', () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        firstName as string
                        middleName asdf asdf asdf
                        lastName as string
                    end class
                `);
                let { statements } = Parser.parse(tokens, 'brighterscript');
                let cls = statements[0] as ClassStatement;
                expect(cls.fields[0].name.text).to.equal('firstName');
                expect(cls.fields[cls.fields.length - 1].name.text).to.equal('lastName');
            });

            it(`detects missing type after 'as' keyword`, () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        middleName as
                    end class
                `);
                let { errors, statements } = Parser.parse(tokens, 'brighterscript');
                expect(errors.length).to.be.greaterThan(0);
                let cls = statements[0] as ClassStatement;
                expect(cls.fields[0].name.text).to.equal('middleName');
                expect(errors[0].code).to.equal(diagnosticMessages.Expected_valid_type_to_follow_as_keyword_1018().code);
            });

            it('field access modifier defaults to public when omitted', () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        firstName as string
                    end class
                `);
                let { statements, errors } = Parser.parse(tokens, 'brighterscript');
                expect(errors).to.be.lengthOf(0);
                let cls = statements[0] as ClassStatement;
                expect(cls.fields[0].accessModifier.kind).to.equal(Lexeme.Public);
            });
        });

        describe('methods', () => {
            it('recognizes perfect syntax', () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        public function getName() as string
                            return "name"
                        end function
                    end class
                `);
                let { statements, errors } = Parser.parse(tokens, 'brighterscript');
                expect(errors).to.be.lengthOf(0);
                let theClass = statements[0] as ClassStatement;
                expect(theClass).to.be.instanceof(ClassStatement);
                let method = theClass.methods[0];
                expect(method.name.text).to.equal('getName');
                expect(method.accessModifier.text).to.equal('public');
                expect(method.func).to.exist;
            });

            it('supports omitting method return type', () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        public function getName()
                            return "name"
                        end function
                    end class
                `);
                let { statements, errors } = Parser.parse(tokens, 'brighterscript');
                expect(errors).to.be.lengthOf(0);
                let theClass = statements[0] as ClassStatement;
                let method = theClass.methods[0];
                expect(method.accessModifier.text).to.equal('public');
                expect(method.func).to.exist;
            });

            it('method access modifier defaults to public when omitted', () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        function getName() as string
                            return "name"
                        end function
                    end class
                    `);
                let { statements, errors } = Parser.parse(tokens, 'brighterscript');
                expect(errors).to.be.lengthOf(0);
                let cls = statements[0] as ClassStatement;
                expect(cls.methods[0].accessModifier.kind).to.equal(Lexeme.Public);
            });

            it('detects missing function keyword', () => {
                let { tokens } = Lexer.scan(`
                    class Person
                        public getName() as string
                            return "name"
                        end function
                    end class
                    `);
                let { errors } = Parser.parse(tokens, 'brighterscript');
                expect(errors).to.have.lengthOf(1);
                expect(errors[0].code).to.equal(diagnosticMessages.Missing_function_sub_keyword_1017('').code);
            });
        });
    });
});
