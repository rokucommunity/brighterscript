import { expect } from '../chai-config.spec';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { TokenKind, AllowedLocalIdentifiers, AllowedProperties } from '../lexer/TokenKind';
import { Lexer } from '../lexer/Lexer';
import { Parser, ParseMode } from './Parser';
import type { FunctionStatement, AssignmentStatement, FieldStatement } from './Statement';
import { ClassStatement } from './Statement';
import { NewExpression } from './Expression';
import { expectDiagnosticsIncludes, expectZeroDiagnostics } from '../testHelpers.spec';
import { isClassStatement } from '../astUtils/reflection';
import { StringType } from '../types/StringType';
import { SymbolTypeFlag } from '../SymbolTableFlag';

describe('parser class', () => {
    it('throws exception when used in brightscript scope', () => {
        let { tokens } = Lexer.scan(`
                class Person
                end class
            `);
        let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });
        expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
    });


    for (let keyword of AllowedProperties) {
        //skip a few of the class-specific keywords that are not allowed as field/method names

        if ([
            TokenKind.Function,
            TokenKind.Rem,
            TokenKind.Sub,
            TokenKind.Public,
            TokenKind.Protected,
            TokenKind.Private,
            TokenKind.Override
        ].includes(keyword)) {
            continue;
        }
        it(`supports ${keyword} as property name`, () => {
            //test as property
            let { tokens } = Lexer.scan(`
                class Person
                    ${keyword} as string
                end class
            `);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(ClassStatement);
        });

        it(`supports ${keyword} as method name`, () => {
            //test as property
            let { tokens } = Lexer.scan(`
                class Person
                   sub ${keyword}()
                   end sub
                end class
            `);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics[0]?.message).not.to.exist;
            expect(statements[0]).instanceof(ClassStatement);
        });
    }

    for (let keyword of AllowedLocalIdentifiers) {
        it(`supports ${keyword} as class name`, () => {
            //test as property
            let { tokens } = Lexer.scan(`
                class ${keyword}
                end class
            `);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(ClassStatement);
        });
    }

    it('does not allow "throw" to be defined as a local var', () => {
        const parser = Parser.parse(`
            sub main()
                'not allowed to define "throw" as local var
                throw = true
            end sub
        `);

        expect(parser.diagnostics[0]?.message).to.eql(DiagnosticMessages.unexpectedToken('=').message);
    });

    it('does not allow function named "throw"', () => {
        const parser = Parser.parse(`
            'not allowed to define a function called "throw"
            sub throw()
            end sub
        `);

        expect(parser.diagnostics[0]?.message).to.eql(DiagnosticMessages.cannotUseReservedWordAsIdentifier('throw').message);
    });

    it('supports the try/catch keywords in various places', () => {
        const parser = Parser.parse(`
            sub main()
                'allowed to be local vars
                try = true
                catch = true
                endTry = true
                'not allowed to use throw as local variable
                'throw = true

                'allowed to be object props
                person = {
                try: true,
                catch: true,
                endTry: true,
                throw: true
                }

                person.try = true
                person.catch = true
                person.endTry = true
                person.throw = true

                'allowed as object property reference
                print person.try
                print person.catch
                print person.endTry
                print person.throw
            end sub

            sub try()
            end sub

            sub catch()
            end sub

            sub endTry()
            end sub

            'not allowed to define a function called "throw"
            ' sub throw()
            ' end sub
        `);

        expect(parser.diagnostics[0]?.message).not.to.exist;
    });

    it('parses empty class', () => {
        let { tokens } = Lexer.scan(`
                class Person
                end class
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements[0]).instanceof(ClassStatement);
    });

    it('bad property does not invalidate next sibling method', () => {
        let { tokens } = Lexer.scan(`
                class Person
                    public firstname =
                    public sub new()
                    end sub
                end class
            `);
        let { statements } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        let classStatement = statements[0] as ClassStatement;
        expect(classStatement.methods[0]).to.exist;
        expect(classStatement.methods[0].tokens.name.text).to.equal('new');
    });

    it('catches class without name', () => {
        let { tokens } = Lexer.scan(`
                class
                end class
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expect(diagnostics).length.to.be.greaterThan(0);
        expect(diagnostics[0].code).to.equal(DiagnosticMessages.expectedIdentifierAfterKeyword('class').code);
        expect(statements[0]).instanceof(ClassStatement);
    });

    it('catches malformed class', () => {
        let { tokens } = Lexer.scan(`
                class Person
            `);
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expect(diagnostics).length.to.be.greaterThan(0);
        expect(statements[0]).instanceof(ClassStatement);
    });

    describe('fields', () => {
        it('identifies perfect syntax', () => {
            let { tokens } = Lexer.scan(`
                    class Person
                        public firstName as string
                    end class
                `);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.empty;
            expect(statements[0]).instanceof(ClassStatement);
            let field = (statements[0] as ClassStatement).body[0] as FieldStatement;
            expect(field.tokens.accessModifier!.kind).to.equal(TokenKind.Public);
            expect(field.tokens.name!.text).to.equal('firstName');
            expect(field.tokens.as!.text).to.equal('as');
            expect(field.getType({ flags: SymbolTypeFlag.typetime }))!.to.be.instanceOf(StringType);
        });

        it('can be solely an identifier', () => {
            let { tokens } = Lexer.scan(`
                    class Person
                        firstName
                    end class
                `);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            let cls = statements[0] as ClassStatement;
            expect(cls.fields[0].tokens.name!.text).to.equal('firstName');
        });

        it('malformed field does not impact leading and trailing fields', () => {
            let { tokens } = Lexer.scan(`
                    class Person
                        firstName as string
                        middleName asdf asdf asdf
                        lastName as string
                    end class
                `);
            let { statements } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            let cls = statements[0] as ClassStatement;
            expect(cls.fields[0].tokens.name!.text).to.equal('firstName');
            expect(cls.fields[cls.fields.length - 1].tokens.name!.text).to.equal('lastName');
        });

        it(`detects missing type after 'as' keyword`, () => {
            let { tokens } = Lexer.scan(`
                class Person
                    middleName as
                end class
            `);
            let { diagnostics, statements } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics.length).to.be.greaterThan(0);
            let cls = statements[0] as ClassStatement;
            expect(cls.fields[0].tokens.name!.text).to.equal('middleName');
            expectDiagnosticsIncludes(diagnostics, DiagnosticMessages.expectedIdentifierAfterKeyword('as'));
        });

        it('field access modifier defaults to undefined when omitted', () => {
            let { tokens } = Lexer.scan(`
                    class Person
                        firstName as string
                    end class
                `);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            let cls = statements[0] as ClassStatement;
            expect(cls.fields[0].tokens.accessModifier).to.be.undefined;
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
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            let theClass = statements[0] as ClassStatement;
            expect(theClass).to.be.instanceof(ClassStatement);
            let method = theClass.methods[0];
            expect(method.tokens.name.text).to.equal('getName');
            expect(method.accessModifier!.text).to.equal('public');
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
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            let theClass = statements[0] as ClassStatement;
            let method = theClass.methods[0];
            expect(method.accessModifier!.text).to.equal('public');
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
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.be.lengthOf(0);
            let cls = statements[0] as ClassStatement;
            expect(cls.methods[0].accessModifier).to.be.undefined;
        });

        it('supports primitive field initializers', () => {
            let { tokens } = Lexer.scan(`
                class Person
                    name = "Bob"
                    age = 20
                    isAlive = true
                    callback = sub()
                        print "hello"
                    end sub
                end class
            `);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics[0]?.message).not.to.exist;
            let cls = statements[0] as ClassStatement;
            expect((cls.memberMap['name'] as FieldStatement).initialValue).to.exist;
            expect((cls.memberMap['age'] as FieldStatement).initialValue).to.exist;
            expect((cls.memberMap['isalive'] as FieldStatement).initialValue).to.exist;
            expect((cls.memberMap['callback'] as FieldStatement).initialValue).to.exist;
        });

        it('detects missing function keyword', () => {
            let { tokens } = Lexer.scan(`
                    class Person
                        public getName() as string
                            return "name"
                        end function
                    end class
                    `);
            let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(diagnostics).to.have.lengthOf(1);
            expect(diagnostics[0].code).to.equal(DiagnosticMessages.missingCallableKeyword().code);
        });
    });

    it('supports comments in various locations', () => {
        let { diagnostics } = Parser.parse(`
            'comment
            class Animal 'comment
                'comment
                sub new() 'comment
                    'comment
                end sub 'comment
                'comment
            end class 'comment
        `, { mode: ParseMode.BrighterScript });

        expect(diagnostics[0]?.message).to.not.exist;
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
        let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expect(diagnostics[0]?.message).to.not.exist;
        let stmt = (statements[1] as ClassStatement);
        expect(stmt.tokens.extends!.text).to.equal('extends');
        expect(stmt.parentClassName.getName()).to.equal('Person');
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
        let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
        expect(diagnostics[0].code).to.equal(DiagnosticMessages.expectedIdentifierAfterKeyword('extends').code);
    });

    describe('new keyword', () => {
        it('parses properly', () => {
            let { statements, diagnostics } = Parser.parse(`
                sub main()
                    a = new Animal()
                end sub
                class Animal
                end class
            `, { mode: ParseMode.BrighterScript });

            expect(diagnostics[0]?.message).to.not.exist;
            let body = (statements[0] as FunctionStatement).func.body;
            let stmt = (body.statements[0] as AssignmentStatement);
            expect(stmt.value).to.be.instanceof(NewExpression);
        });

        it('is allowed to be used as a local variable in brs files', () => {
            let { diagnostics } = Parser.parse(`
                sub main()
                  new = true
                  old = new
                end sub
            `, { mode: ParseMode.BrightScript });

            expect(diagnostics[0]?.message).to.not.exist;
        });
    });

    describe('optional members', () => {
        it('allows optional fields', () => {
            let { statements, diagnostics } = Parser.parse(`
                class HasOptional
                    optional name as string
                    optional height
                end class
            `, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isClassStatement(statements[0])).to.be.true;
            const klass = statements[0] as ClassStatement;
            klass.fields.forEach(f => expect(f.isOptional).to.be.true);
            const klassType = klass.getType({ flags: SymbolTypeFlag.typetime });
            // eslint-disable-next-line no-bitwise
            klassType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime).forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(SymbolTypeFlag.optional));
        });

        it('allows fields named optional', () => {
            let { statements, diagnostics } = Parser.parse(`
                class IsJustOptional
                    optional
                    someThingElse
                end class
            `, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isClassStatement(statements[0])).to.be.true;
            const klass = statements[0] as ClassStatement;
            klass.fields.forEach(f => expect(f.isOptional).to.be.false);
            const klassType = klass.getType({ flags: SymbolTypeFlag.typetime });
            const klassMembers = klassType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime);
            expect(klassMembers.length).to.eq(2);
            // eslint-disable-next-line no-bitwise
            klassMembers.forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(0));
        });

        it('allows typed fields named optional', () => {
            let { statements, diagnostics } = Parser.parse(`
                class IsJustOptional
                    optional as string
                end class
            `, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isClassStatement(statements[0])).to.be.true;
            const klass = statements[0] as ClassStatement;
            klass.fields.forEach(f => expect(f.isOptional).to.be.false);
            const klassType = klass.getType({ flags: SymbolTypeFlag.typetime });
            const klassMembers = klassType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime);
            expect(klassMembers.length).to.eq(1);
            // eslint-disable-next-line no-bitwise
            klassMembers.forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(0));
        });

        it('allows fields named optional that are also optional', () => {
            let { statements, diagnostics } = Parser.parse(`
                class IsJustOptional
                    optional optional
                end class
            `, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isClassStatement(statements[0])).to.be.true;
            const klass = statements[0] as ClassStatement;
            klass.fields.forEach(f => expect(f.isOptional).to.be.true);
            const klassType = klass.getType({ flags: SymbolTypeFlag.typetime });
            const klassMembers = klassType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime);
            expect(klassMembers.length).to.eq(1);
            // eslint-disable-next-line no-bitwise
            klassMembers.forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(SymbolTypeFlag.optional));
        });

        it('disallows optional methods', () => {
            let { statements, diagnostics } = Parser.parse(`
                class HasOptional

                    optional function getValue() as boolean
                        return false
                    end function
                end class
            `, { mode: ParseMode.BrighterScript });
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.expectedNewlineOrColon().message
            ]);
            expect(statements.length).to.eq(1);
        });

        it('allows fields named `as` that are also optional', () => {
            let { statements, diagnostics } = Parser.parse(`
                class IsJustOptional
                    optional as
                end class
            `, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isClassStatement(statements[0])).to.be.true;
            const klass = statements[0] as ClassStatement;
            klass.fields.forEach(f => expect(f.isOptional).to.be.true);
            const klassType = klass.getType({ flags: SymbolTypeFlag.typetime });
            const klassMembers = klassType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime);
            expect(klassMembers.length).to.eq(1);
            // eslint-disable-next-line no-bitwise
            klassMembers.forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(SymbolTypeFlag.optional));
        });
    });
});
