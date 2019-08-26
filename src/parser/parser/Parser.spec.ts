import { expect } from 'chai';

import { diagnosticMessages } from '../../DiagnosticMessages';
import { Lexeme, Lexer } from '../lexer';
import { Parser } from './Parser';
import { ClassFieldStatement, ClassStatement, FunctionStatement, SingleLineCommentStatement } from './Statement';

describe('parser', () => {
    let parser: Parser;
    beforeEach(() => {
        parser = new Parser();
    });
    it('emits empty object when empty token list is provided', () => {
        expect(Parser.parse([])).to.deep.include({
            statements: [],
            errors: []
        });
    });

    describe('parse', () => {
        it('parses declaration-level comments', () => {
            let { tokens } = Lexer.scan(`
                'a comment
                function a()
                end function
            `);
            let { errors, statements } = parser.parse(tokens);
            expect((statements as any)[0].comment.text).to.equal('a comment');
            expect(errors).to.be.lengthOf(0);
        });

        it('parses comment at end of function declaration first line', () => {
            let { tokens } = Lexer.scan(`
                function a() 'a comment
                end function
            `);
            let { errors, statements } = parser.parse(tokens);
            expect(errors).to.be.lengthOf(0);
            let comment = (statements[0] as FunctionStatement).func.body.statements[0] as SingleLineCommentStatement;
            expect(comment.comment.text).to.equal('a comment');
        });

        it('parses comment in function body', () => {
            let { tokens } = Lexer.scan(`
                function a()
                    'comment 1
                    num = 1
                    'comment 2
                end function
            `);
            let { errors, statements } = parser.parse(tokens);
            expect(errors).to.be.lengthOf(0, 'Should have zero errors');
            let comment = (statements[0] as FunctionStatement).func.body.statements[0] as SingleLineCommentStatement;
            expect(comment.comment.text).to.equal('comment 1');
            comment = (statements[0] as FunctionStatement).func.body.statements[2] as SingleLineCommentStatement;
            expect(comment.comment.text).to.equal('comment 2');
        });

        it('parses comment at end of `end function`', () => {
            let { tokens } = Lexer.scan(`
                function a()
                end function 'a comment
            `);
            let { errors, statements } = parser.parse(tokens);
            expect(errors).to.be.lengthOf(0);
            expect((statements as any)[1].comment.text).to.equal('a comment');
        });

        it.skip('parses comments at end of if statement declaration`', () => {
            let { tokens } = Lexer.scan(`
                function a()
                    if true then 'a comment
                    end if
                end function
            `);
            let { errors, statements } = parser.parse(tokens);
            expect(errors).to.be.lengthOf(0);
            let comment = (statements as any)[0].func.body.statements[0].thenBranch.statements[0];
            expect(comment.text).to.equal('a comment');
        });

    });
    describe('events', () => {
        it('emits events', () => {
            let parser = new Parser();
            let count = 0;
            let handler = parser.onError(() => {
                count++;
            });
            parser.parse(Lexer.scan('function').tokens);
            parser.parse(Lexer.scan('function').tokens);
            expect(count).to.equal(2);
            //disposing the listener stops new counts
            handler.dispose();
            parser.parse(Lexer.scan('function').tokens);
            expect(count).to.equal(2);
        });
        describe('onErrorOnce', () => {
            it('stops emitting after first error', () => {
                let parser = new Parser();
                let count = 0;
                parser.onErrorOnce(() => {
                    count++;
                });
                parser.parse(Lexer.scan('function').tokens);
                parser.parse(Lexer.scan('function').tokens);
                expect(count).to.equal(1);
            });
        });
    });
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
