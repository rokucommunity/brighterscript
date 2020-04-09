import { expect } from 'chai';
import { diagnosticMessages } from '../DiagnosticMessages';
import { TokenKind, Lexer } from '../lexer';
import { Parser, ParseMode } from './Parser';
import { ClassFieldStatement, ClassStatement } from './ClassStatement';
import { FunctionStatement, AssignmentStatement } from './Statement';
import { NewExpression } from './Expression';

describe('parser class', () => {
    it('throws exception when used in brightscript scope', () => {
        let { tokens } = Lexer.scan(`
                class Person
                end class
            `);
        let { diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brightscript });
        expect(errors[0]?.code).to.equal(diagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);

    });
    it('parses empty class', () => {
        let { tokens } = Lexer.scan(`
                class Person
                end class
            `);
        let { statements, diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
        expect(errors).to.be.lengthOf(0);
        expect(statements[0]).instanceof(ClassStatement);
    });

    it('catches class without name', () => {
        let { tokens } = Lexer.scan(`
                class
                end class
            `);
        let { statements, diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
        expect(errors).length.to.be.greaterThan(0);
        expect(errors[0].code).to.equal(diagnosticMessages.missingIdentifierAfterClassKeyword().code);
        expect(statements[0]).instanceof(ClassStatement);
    });

    it('catches malformed class', () => {
        let { tokens } = Lexer.scan(`
                class Person
            `);
        let { statements, diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
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
            let { statements, diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
            expect(errors).to.be.empty;
            expect(statements[0]).instanceof(ClassStatement);
            let field = (statements[0] as ClassStatement).members[0] as ClassFieldStatement;
            expect(field.accessModifier.kind).to.equal(TokenKind.Public);
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
            let { statements, diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
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
            let { statements } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
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
            let { diagnostics: errors, statements } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
            expect(errors.length).to.be.greaterThan(0);
            let cls = statements[0] as ClassStatement;
            expect(cls.fields[0].name.text).to.equal('middleName');
            expect(errors[0].code).to.equal(diagnosticMessages.expectedValidTypeToFollowAsKeyword().code);
        });

        it('field access modifier defaults to undefined when omitted', () => {
            let { tokens } = Lexer.scan(`
                    class Person
                        firstName as string
                    end class
                `);
            let { statements, diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
            expect(errors).to.be.lengthOf(0);
            let cls = statements[0] as ClassStatement;
            expect(cls.fields[0].accessModifier).to.be.undefined;
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
            let { statements, diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
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
            let { statements, diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
            expect(errors).to.be.lengthOf(0);
            let theClass = statements[0] as ClassStatement;
            let method = theClass.methods[0];
            expect(method.accessModifier.text).to.equal('public');
            expect(method.func).to.exist;
        });

        it('method access modifier is undefined when omitted', () => {
            let { tokens } = Lexer.scan(`
                    class Person
                        function getName() as string
                            return "name"
                        end function
                    end class
                    `);
            let { statements, diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
            expect(errors).to.be.lengthOf(0);
            let cls = statements[0] as ClassStatement;
            expect(cls.methods[0].accessModifier).to.be.undefined;
        });

        it('detects missing function keyword', () => {
            let { tokens } = Lexer.scan(`
                    class Person
                        public getName() as string
                            return "name"
                        end function
                    end class
                    `);
            let { diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
            expect(errors).to.have.lengthOf(1);
            expect(errors[0].code).to.equal(diagnosticMessages.missingCallableKeyword('').code);
        });
    });

    it('recognizes the "extends" keyword', () => {
        let { tokens } = Lexer.scan(`
            class Person
                public sub sayHi()
                    print "hi"
                end sub
            end class

            class Toddler extends Person
            end class
        `);
        let { statements, diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
        expect(errors[0]?.message).to.not.exist;
        let stmt = (statements[1] as ClassStatement);
        expect(stmt.extendsKeyword.text).to.equal('extends');
        expect(stmt.extendsIdentifier.text).to.equal('Person');
    });

    it('catches missing identifier after "extends" keyword', () => {
        let { tokens } = Lexer.scan(`
            class Person
                public sub sayHi()
                    print "hi"
                end sub
            end class

            class Toddler extends
            end class
        `);
        let { diagnostics: errors } = Parser.parse(tokens, { mode: ParseMode.brighterscript });
        expect(errors[0].code).to.equal(diagnosticMessages.missingIdentifierAfterExtendsKeyword().code);
    });

    describe('new keyword', () => {
        it('parses properly', () => {
            let { statements, diagnostics: errors } = Parser.parse(`
                sub main()
                    a = new Animal()
                end sub
                class Animal
                end class
            `, { mode: ParseMode.brighterscript });

            expect(errors[0]?.message).to.not.exist;
            let body = (statements[0] as FunctionStatement).func.body;
            let stmt = (body.statements[0] as AssignmentStatement);
            expect(stmt.value).to.be.instanceof(NewExpression);
        });
    });
});
