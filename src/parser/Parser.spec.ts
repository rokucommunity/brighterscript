import { expect } from 'chai';
import { Lexer, ReservedWords } from '../lexer';
import { DottedGetExpression, XmlAttributeGetExpression, CallfuncExpression } from './Expression';
import { Parser, ParseMode } from './Parser';
import { PrintStatement, AssignmentStatement, FunctionStatement, NamespaceStatement, ImportStatement } from './Statement';
import { Range } from 'vscode-languageserver';
import { DiagnosticMessages } from '../DiagnosticMessages';

describe('parser', () => {
    it('emits empty object when empty token list is provided', () => {
        expect(Parser.parse([])).to.deep.include({
            statements: [],
            diagnostics: []
        });
    });

    describe('findReferences', () => {
        it('gets called if references are missing', () => {
            const parser = Parser.parse(`
                sub main()
                end sub

                sub UnusedFunction()
                end sub
            `);
            expect(parser.references.functionStatements.map(x => x.name.text)).to.eql([
                'main',
                'UnusedFunction'
            ]);
            //simulate a tree-shaking plugin by removing the `UnusedFunction`
            parser.ast.statements.splice(1);
            //tell the parser we modified the AST and need to regenerate references
            parser.clearReferences();
            expect(parser['_references']).not.to.exist;
            //calling `references` automatically regenerates the references
            expect(parser.references.functionStatements.map(x => x.name.text)).to.eql([
                'main'
            ]);
        });
    });

    describe('callfunc operator', () => {
        it('is not allowed in brightscript mode', () => {
            let parser = parse(`
                sub main(node as dynamic)
                    node@.doSomething(1, 2)
                end sub
            `, ParseMode.BrightScript);
            expect(
                parser.diagnostics[0]?.message
            ).to.equal(
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('callfunc operator').message
            );
        });

        it('does not cause parse errors', () => {
            let parser = parse(`
                sub main(node as dynamic)
                    node@.doSomething(1, 2)
                end sub
            `, ParseMode.BrighterScript);
            expect(parser.diagnostics[0]?.message).not.to.exist;
            expect((parser as any).statements[0]?.func?.body?.statements[0]?.expression).to.be.instanceof(CallfuncExpression);
        });
    });

    describe('diagnostic locations', () => {
        it('tracks basic diagnostic locations', () => {
            expect(parse(`
                sub main()
                    call()a
                end sub
            `).diagnostics.map(x => rangeToArray(x.range))).to.eql([
                [2, 26, 2, 27]
            ]);
        });

        it.skip('handles edge cases', () => {
            let diagnostics = parse(`
                function BuildCommit()
                    return "6c5cdf1"
                end functionasdf
            `).diagnostics;
            expect(diagnostics[0]?.message).to.exist.and.to.eql(
                DiagnosticMessages.expectedStatementOrFunctionCallButReceivedExpression().message
            );

            expect(diagnostics[0]?.range).to.eql(
                Range.create(3, 20, 3, 32)
            );
        });
    });

    describe('parse', () => {
        it('supports using "interface" as parameter name', () => {
            expect(parse(`
                sub main(interface as object)
                end sub
            `, ParseMode.BrighterScript).diagnostics[0]?.message).not.to.exist;
        });
        describe('namespace', () => {
            it('catches namespaces declared not at root level', () => {
                expect(parse(`
                    sub main()
                        namespace Name.Space
                        end namespace
                    end sub
                `, ParseMode.BrighterScript).diagnostics[0]?.message).to.equal(
                    DiagnosticMessages.keywordMustBeDeclaredAtRootLevel('namespace').message
                );
            });
            it('parses empty namespace', () => {
                let { statements, diagnostics } =
                    parse(`
                        namespace Name.Space
                        end namespace
                    `, ParseMode.BrighterScript);
                expect(diagnostics[0]?.message).not.to.exist;
                expect(statements[0]).to.be.instanceof(NamespaceStatement);
            });
            it('includes body', () => {
                let { statements, diagnostics } =
                    parse(`
                        namespace Name.Space
                            sub main()
                            end sub
                        end namespace
                    `, ParseMode.BrighterScript);
                expect(diagnostics[0]?.message).not.to.exist;
                expect(statements[0]).to.be.instanceof(NamespaceStatement);
                expect((statements[0] as NamespaceStatement).body.statements[0]).to.be.instanceof(FunctionStatement);
            });
            it('supports comments and newlines', () => {
                let { diagnostics } =
                    parse(`
                        namespace Name.Space 'comment

                        'comment

                            sub main() 'comment
                            end sub 'comment
                            'comment

                            'comment
                        end namespace 'comment
                    `, ParseMode.BrighterScript);
                expect(diagnostics[0]?.message).not.to.exist;
            });

            it('catches missing name', () => {
                let { diagnostics } =
                    parse(`
                        namespace
                        end namespace
                    `, ParseMode.BrighterScript);
                expect(diagnostics[0]?.message).to.equal(
                    DiagnosticMessages.expectedIdentifierAfterKeyword('namespace').message
                );
            });

            it('recovers after missing `end namespace`', () => {
                let parser = parse(`
                    namespace Name.Space
                        sub main()
                        end sub
                `, ParseMode.BrighterScript);
                expect(parser.ast.statements[0]).to.be.instanceof(NamespaceStatement);

                expect(parser.diagnostics[0]?.message).to.equal(
                    DiagnosticMessages.couldNotFindMatchingEndKeyword('namespace').message
                );

                expect((parser.ast.statements[0] as NamespaceStatement)?.body?.statements[0]).to.be.instanceof(FunctionStatement);
            });

            it('adds diagnostic when encountering namespace in brightscript mode', () => {
                let parser = Parser.parse(`
                    namespace Name.Space
                    end namespace
                `);
                expect(parser.diagnostics[0]?.message).to.equal(
                    DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('namespace').message
                );
            });
        });

        it('supports << operator', () => {
            expect(parse(`
                sub main()
                    print ((r << 24) + (g << 16) + (b << 8) + a)
                end sub
            `).diagnostics[0]?.message).not.to.exist;
        });

        it('supports >> operator', () => {
            expect(parse(`
                sub main()
                    print ((r >> 24) + (g >> 16) + (b >> 8) + a)
                end sub
            `).diagnostics[0]?.message).not.to.exist;
        });

        it('allows global function names with same as token to be called', () => {
            expect(parse(`
                sub main()
                    print string(123)
                end sub
            `).diagnostics[0]?.message).not.to.exist;
        });

        it('supports @ symbol between names', () => {
            let parser = parse(`
                sub main()
                    firstName = personXml@firstName
                    age = personXml.firstChild@age
                end sub
            `);
            expect(parser.diagnostics[0]?.message).to.not.exist;

            let statements = (parser.statements[0] as FunctionStatement).func.body.statements as AssignmentStatement[];
            let first = statements[0].value as XmlAttributeGetExpression;
            expect(first).to.be.instanceof(XmlAttributeGetExpression);
            expect(first.name.text).to.equal('firstName');
            expect(first.at.text).to.equal('@');
            expect((first.obj as any).name.text).to.equal('personXml');

            let second = statements[1].value as XmlAttributeGetExpression;
            expect(second).to.be.instanceof(XmlAttributeGetExpression);
            expect(second.name.text).to.equal('age');
            expect(second.at.text).to.equal('@');
            expect((second.obj as any).name.text).to.equal('firstChild');
        });

        it('does not allow chaining of @ symbols', () => {
            let parser = parse(`
                sub main()
                    personXml = invalid
                    name = personXml@name@age@shoeSize
                end sub
            `);
            expect(parser.diagnostics).not.to.be.empty;
        });
        it('unknown function type does not invalidate rest of function', () => {
            let { statements, diagnostics } = parse(`
                function log() as UNKNOWN_TYPE
                end function
            `);
            expect(diagnostics.length).to.be.greaterThan(0);
            expect(statements[0]).to.exist;
        });
        it('works with conditionals', () => {
            expect(parse(`
                function printNumber()
                    if true then
                        print 1
                    else if true
                        print 2
                    end if
                end function
            `).diagnostics[0]?.message).not.to.exist;
        });

        it('supports single-line if statements', () => {
            expect(parse(`If true Then print "error" : Stop`).diagnostics[0]?.message).to.not.exist;
        });

        it('works with excess newlines', () => {
            let { tokens } = Lexer.scan(
                'function boolToNumber() as string\n\n' +
                '   if true then\n\n' +
                '       print 1\n\n' +
                '   elseif true then\n\n' +
                '       print 0\n\n' +
                '   else\n\n' +
                '       print 1\n\n' +
                '   end if\n\n' +
                'end function\n\n'
            );
            expect(Parser.parse(tokens).diagnostics[0]?.message).to.not.exist;
        });
        it('does not invalidate entire file when line ends with a period', () => {
            let { tokens } = Lexer.scan(`
                sub main()
                    person.a
                end sub

            `);
            let { diagnostics } = Parser.parse(tokens) as any;
            expect(diagnostics).to.be.lengthOf(1, 'Error count should be 0');
        });

        it.skip('allows printing object with trailing period', () => {
            let { tokens } = Lexer.scan(`print a.`);
            let { statements, diagnostics } = Parser.parse(tokens);
            let printStatement = statements[0] as PrintStatement;
            expect(diagnostics).to.be.empty;
            expect(printStatement).to.be.instanceof(PrintStatement);
            expect(printStatement.expressions[0]).to.be.instanceof(DottedGetExpression);
        });

        describe('comments', () => {
            it('combines multi-line comments', () => {
                let { tokens } = Lexer.scan(`
                    'line 1
                    'line 2
                    'line 3
                `);
                let { diagnostics, statements } = Parser.parse(tokens) as any;
                expect(diagnostics).to.be.lengthOf(0, 'Error count should be 0');

                expect(statements[0].text).to.equal(`'line 1\n'line 2\n'line 3`);
            });

            it('does not combile comments separated by newlines', () => {
                let { tokens } = Lexer.scan(`
                    'line 1

                    'line 2

                    'line 3
                `);
                let { diagnostics, statements } = Parser.parse(tokens) as any;
                expect(diagnostics).to.be.lengthOf(0, 'Error count should be 0');

                expect(statements).to.be.lengthOf(3);

                expect(statements[0].text).to.equal(`'line 1`);
                expect(statements[1].text).to.equal(`'line 2`);
                expect(statements[2].text).to.equal(`'line 3`);
            });

            it('works after print statement', () => {
                let { tokens } = Lexer.scan(`
                    sub main()
                        print "hi" 'comment 1
                    end sub
                `);
                let { diagnostics, statements } = Parser.parse(tokens);
                expect(diagnostics).to.be.lengthOf(0, 'Error count should be 0');

                expect((statements as any)[0].func.body.statements[1].text).to.equal(`'comment 1`);
            });

            it('declaration-level', () => {
                let { tokens } = Lexer.scan(`
                    'comment 1
                    function a()
                    end function
                    'comment 2
                `);
                let { diagnostics, statements } = Parser.parse(tokens);
                expect(diagnostics).to.be.lengthOf(0, 'Error count should be 0');
                expect((statements as any)[0].text).to.equal(`'comment 1`);
                expect((statements as any)[2].text).to.equal(`'comment 2`);
            });

            it('works in aa literal as its own statement', () => {
                let { tokens } = Lexer.scan(`
                    obj = {
                        "name": true,
                        'comment
                    }
                `);
                let { diagnostics } = Parser.parse(tokens);
                expect(diagnostics).to.be.lengthOf(0, 'Error count should be 0');
            });

            it('parses after function call', () => {
                let { tokens } = Lexer.scan(`
                    sub Main()
                        name = "Hello"
                        DoSomething(name) 'comment 1
                    end sub
                `);
                let { diagnostics, statements } = Parser.parse(tokens) as any;
                expect(diagnostics).to.be.lengthOf(0, 'Should have zero diagnostics');

                expect(statements[0].func.body.statements[2].text).to.equal(`'comment 1`);
            });

            it('function', () => {
                let { tokens } = Lexer.scan(`
                    function a() 'comment 1
                        'comment 2
                        num = 1
                        'comment 3
                    end function 'comment 4
                `);
                let { diagnostics, statements } = Parser.parse(tokens) as any;
                expect(diagnostics).to.be.lengthOf(0, 'Should have zero diagnostics');

                expect(statements[0].func.body.statements[0].text).to.equal(`'comment 1`);
                expect(statements[0].func.body.statements[1].text).to.equal(`'comment 2`);
                expect(statements[0].func.body.statements[3].text).to.equal(`'comment 3`);
                expect(statements[1].text).to.equal(`'comment 4`);
            });

            it('if statement`', () => {
                let { tokens } = Lexer.scan(`
                    function a()
                        if true then 'comment 1
                            'comment 2
                            print "hello"
                            'comment 3
                        else if true then 'comment 4
                            'comment 5
                            print "hello"
                            'comment 6
                        else 'comment 7
                            'comment 8
                            print "hello"
                            'comment 9
                        end if 'comment 10
                    end function
                `);
                let { diagnostics, statements } = Parser.parse(tokens) as any;
                expect(diagnostics).to.be.lengthOf(0, 'Should have zero diagnostics');
                let ifStmt = statements[0].func.body.statements[0];

                expect(ifStmt.thenBranch.statements[0].text).to.equal(`'comment 1`);
                expect(ifStmt.thenBranch.statements[1].text).to.equal(`'comment 2`);
                expect(ifStmt.thenBranch.statements[3].text).to.equal(`'comment 3`);

                expect(ifStmt.elseIfs[0].thenBranch.statements[0].text).to.equal(`'comment 4`);
                expect(ifStmt.elseIfs[0].thenBranch.statements[1].text).to.equal(`'comment 5`);
                expect(ifStmt.elseIfs[0].thenBranch.statements[3].text).to.equal(`'comment 6`);

                expect(ifStmt.elseBranch.statements[0].text).to.equal(`'comment 7`);
                expect(ifStmt.elseBranch.statements[1].text).to.equal(`'comment 8`);
                expect(ifStmt.elseBranch.statements[3].text).to.equal(`'comment 9`);

                expect(statements[0].func.body.statements[1].text).to.equal(`'comment 10`);

            });

            it('while', () => {
                let { tokens } = Lexer.scan(`
                    function a()
                        while true 'comment 1
                            'comment 2
                            print "true"
                            'comment 3
                        end while 'comment 4
                    end function
                `);
                let { diagnostics, statements } = Parser.parse(tokens) as any;
                expect(diagnostics).to.be.lengthOf(0, 'Error count should be zero');
                let stmt = statements[0].func.body.statements[0];

                expect(stmt.body.statements[0].text).to.equal(`'comment 1`);
                expect(stmt.body.statements[1].text).to.equal(`'comment 2`);
                expect(stmt.body.statements[3].text).to.equal(`'comment 3`);

                expect(statements[0].func.body.statements[1].text).to.equal(`'comment 4`);
            });

            it('for', () => {
                let { tokens } = Lexer.scan(`
                    function a()
                        for i = 0 to 10 step 1 'comment 1
                            'comment 2
                            print 1
                            'comment 3
                        end for 'comment 4
                    end function
                `);
                let { diagnostics, statements } = Parser.parse(tokens) as any;
                expect(diagnostics).to.be.lengthOf(0, 'Error count should be zero');
                let stmt = statements[0].func.body.statements[0];

                expect(stmt.body.statements[0].text).to.equal(`'comment 1`);
                expect(stmt.body.statements[1].text).to.equal(`'comment 2`);
                expect(stmt.body.statements[3].text).to.equal(`'comment 3`);

                expect(statements[0].func.body.statements[1].text).to.equal(`'comment 4`);
            });

            it('for each', () => {
                let { tokens } = Lexer.scan(`
                    function a()
                        for each val in [1,2,3] 'comment 1
                            'comment 2
                            print 1
                            'comment 3
                        end for 'comment 4
                    end function
                `);
                let { diagnostics, statements } = Parser.parse(tokens) as any;
                expect(diagnostics).to.be.lengthOf(0, 'Error count should be zero');
                let stmt = statements[0].func.body.statements[0];

                expect(stmt.body.statements[0].text).to.equal(`'comment 1`);
                expect(stmt.body.statements[1].text).to.equal(`'comment 2`);
                expect(stmt.body.statements[3].text).to.equal(`'comment 3`);

                expect(statements[0].func.body.statements[1].text).to.equal(`'comment 4`);
            });

        });
    });

    describe('reservedWords', () => {
        describe('`then`', () => {
            it('is not allowed as a local identifier', () => {
                let { diagnostics } = parse(`
                    sub main()
                        then = true
                    end sub
                `);
                expect(diagnostics).to.be.lengthOf(1);
            });
            it('is allowed as an AA property name', () => {
                let { diagnostics } = parse(`
                    sub main()
                        person = {
                            then: true
                        }
                        person.then = false
                        print person.then
                    end sub
                `);
                expect(diagnostics[0]?.message).not.to.exist;
            });
        });
        it('"end" is not allowed as a local identifier', () => {
            let { diagnostics } = parse(`
                sub main()
                    end = true
                end sub
            `);
            expect(diagnostics).to.be.lengthOf(1);
        });
        it('none of them can be used as local variables', () => {
            let reservedWords = new Set(ReservedWords);
            //remove the rem keyword because it's a comment...won't cause error
            reservedWords.delete('rem');
            for (let reservedWord of reservedWords) {
                let { tokens } = Lexer.scan(`
                    sub main()
                        ${reservedWord} = true
                    end sub
                `);
                let { diagnostics } = Parser.parse(tokens);
                expect(diagnostics, `assigning to reserved word "${reservedWord}" should have been an error`).to.be.length.greaterThan(0);
            }
        });
    });

    describe('import keyword', () => {

        it('parses without errors', () => {
            let { statements, diagnostics } = parse(`
                import "somePath"
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            expect(statements[0]).to.be.instanceof(ImportStatement);
        });

        it('catches import statements used in brightscript files', () => {
            let { statements, diagnostics } = parse(`
                import "somePath"
            `, ParseMode.BrightScript);
            expect(diagnostics[0]?.message).to.eql(
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('import statements').message
            );
            expect(statements[0]).to.be.instanceof(ImportStatement);
        });

        it('catchs missing file path', () => {
            let { statements, diagnostics } = parse(`
                import
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).to.equal(
                DiagnosticMessages.expectedStringLiteralAfterKeyword('import').message
            );
            expect(statements[0]).to.be.instanceof(ImportStatement);
        });
    });
});

function parse(text: string, mode?: ParseMode) {
    let { tokens } = Lexer.scan(text);
    return Parser.parse(tokens, {
        mode: mode
    });
}

export function rangeToArray(range: Range) {
    return [
        range.start.line,
        range.start.character,
        range.end.line,
        range.end.character
    ];
}
