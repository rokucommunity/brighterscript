import { expect, assert } from 'chai';
import { Lexer } from '../lexer/Lexer';
import { ReservedWords } from '../lexer/TokenKind';
import type { Expression } from './Expression';
import { DottedGetExpression, XmlAttributeGetExpression, CallfuncExpression, AnnotationExpression, CallExpression, FunctionExpression } from './Expression';
import { Parser, ParseMode, getBscTypeFromExpression, TokenUsage } from './Parser';
import type { AssignmentStatement, ClassStatement, Statement } from './Statement';
import { PrintStatement, FunctionStatement, NamespaceStatement, ImportStatement } from './Statement';
import { Position, Range } from 'vscode-languageserver';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { isBlock, isCommentStatement, isDynamicType, isFunctionStatement, isIfStatement, isIntegerType, isLazyType, isUninitializedType } from '../astUtils/reflection';
import { expectSymbolTableEquals, expectZeroDiagnostics } from '../testHelpers.spec';
import { BrsTranspileState } from './BrsTranspileState';
import { SourceNode } from 'source-map';
import { BrsFile } from '../files/BrsFile';
import { Program } from '../Program';
import { SymbolTable } from '../SymbolTable';
import { FunctionType } from '../types/FunctionType';
import { LazyType } from '../types/LazyType';
import { IntegerType } from '../types/IntegerType';
import { StringType } from '../types/StringType';
import { ObjectType } from '../types/ObjectType';
import { CustomType } from '../types/CustomType';
import { VoidType } from '../types/VoidType';
import { DynamicType } from '../types/DynamicType';
import { util } from '../util';
import { ArrayType } from '../types/ArrayType';

describe('parser', () => {
    it('emits empty object when empty token list is provided', () => {
        expect(Parser.parse([])).to.deep.include({
            statements: [],
            diagnostics: []
        });
    });

    describe('findReferences', () => {
        it('recomputes localVars', () => {
            const parser = Parser.parse(`
                sub main(herd)
                    for each zombie in herd
                        isAlive = false
                    end for
                    for i = 0 to 10 step 1
                        j = i
                    end for
                    humansAreAlive = false
                end sub
            `);
            expect(
                parser.references.functionExpressions[0].symbolTable.getOwnSymbols().map(x => x.name).sort()
            ).to.eql([
                'herd',
                'humansAreAlive',
                'i',
                'isAlive',
                'j',
                'zombie'
            ]);
            parser.invalidateReferences();
            expect(
                parser.references.functionExpressions[0].symbolTable.getOwnSymbols().map(x => x.name).sort()
            ).to.eql([
                'herd',
                'humansAreAlive',
                'i',
                'isAlive',
                'j',
                'zombie'
            ]);
        });

        it('assigns localVars to correct function expression bucket', () => {
            const parser = Parser.parse(`
                sub main()
                    outerName = "bob"
                    speak = sub()
                        innerName = "innerBob"
                    end sub
                    age = 12
                end sub
            `);
            parser.invalidateReferences();
            expect(
                parser.references.functionExpressions.map(x => {
                    return x.symbolTable.getOwnSymbols().map(x => x.name);
                })
            ).to.eql([
                [
                    'outerName',
                    'speak',
                    'age'
                ],
                [
                    'innerName'
                ]
            ]);
        });

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
            parser.invalidateReferences();
            expect(parser['_references']).not.to.exist;
            //calling `references` automatically regenerates the references
            expect(parser.references.functionStatements.map(x => x.name.text)).to.eql([
                'main'
            ]);
        });

        function expressionsToStrings(expressions: Set<Expression>) {
            return [...expressions.values()].map(x => {
                const file = new BrsFile('', '', new Program({} as any));
                const state = new BrsTranspileState(file);
                return new SourceNode(null, null, null, x.transpile(state)).toString();
            });
        }

        it('works for references.expressions', () => {
            const parser = Parser.parse(`
                a += 1 + 2
                a++
                a--
                some.node@.doCallfunc()
                bravo(3 + 4).jump(callMe())
                obj = {
                    val1: someValue
                }
                arr = [
                    one
                ]
                thing = alpha.bravo
                alpha.charlie()
                delta(alpha.delta)
                call1().a.b.call2()
                class Person
                    name as string = "bob"
                end class
                function thing(p1 = name.space.getSomething())

                end function
            `);
            const expected = [
                'a += 1 + 2',
                'a++',
                'a--',
                //currently the "toString" does a transpile, so that's why this is different.
                'some.node.callfunc("doCallfunc", invalid)',
                '3 + 4',
                'callMe()',
                'bravo(3 + 4).jump(callMe())',
                'someValue',
                '{\n    val1: someValue\n}',
                'one',
                '[\n    one\n]',
                'alpha.bravo',
                'alpha.charlie()',
                'alpha.delta',
                'delta(alpha.delta)',
                'call1().a.b.call2()',
                '"bob"',
                'name.space.getSomething()'
            ].sort();

            expect(
                expressionsToStrings(parser.references.expressions).sort()
            ).to.eql(expected);

            //tell the parser we modified the AST and need to regenerate references
            parser.invalidateReferences();

            expect(
                expressionsToStrings(parser.references.expressions).sort()
            ).to.eql(expected);
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
                [2, 26, 2, 27],
                [2, 27, 2, 28]
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
        it('supports ungrouped iife in assignment', () => {
            const parser = parse(`
                sub main()
                    result = sub()
                    end sub()
                    result = function()
                    end function()
                end sub
            `);
            expectZeroDiagnostics(parser);
        });

        it('supports grouped iife in assignment', () => {
            const parser = parse(`
                sub main()
                    result = (sub()
                    end sub)()
                    result = (function()
                    end function)()
                end sub
            `);
            expectZeroDiagnostics(parser);
        });

        it('supports returning iife call', () => {
            const parser = parse(`
                sub main()
                    return (sub()
                    end sub)()
                end sub
            `);
            expectZeroDiagnostics(parser);
        });

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

            it('declares a symbol table for the namespace', () => {
                let parser = parse(`
                    namespace Name.Space
                        function funcInt() as integer
                           return 3
                        end function

                        function funcStr() as string
                           return "hello"
                        end function
                    end namespace
                `, ParseMode.BrighterScript);

                expect(parser.ast.statements[0]).to.be.instanceof(NamespaceStatement);
                const namespaceStmt = parser.ast.statements[0] as NamespaceStatement;
                expect(namespaceStmt.symbolTable).to.be.instanceof(SymbolTable);
                expect(namespaceStmt.symbolTable.getSymbolType('funcInt').toString()).to.equal('function funcInt() as integer');
                expect(namespaceStmt.symbolTable.getSymbolType('funcStr')).to.be.instanceof(FunctionType);
                const strFunctionType = namespaceStmt.symbolTable.getSymbolType('funcStr') as FunctionType;
                expect(strFunctionType.returnType.toString()).to.equal('string');
            });

            it('adds a fully qualified name of a function in a namespace to the parsers symbol table', () => {
                let parser = parse(`
                    namespace Name.Space
                        function funcInt() as integer
                           return 3
                        end function

                        function funcStr() as string
                           return "hello"
                        end function
                    end namespace
                `, ParseMode.BrighterScript);

                expect(parser.symbolTable.getSymbolType('Name.Space.funcInt')).to.be.instanceof(FunctionType);
                expect(parser.symbolTable.getSymbolType('Name.Space.funcStr')).to.be.instanceof(FunctionType);
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
            `, ParseMode.BrightScript);
            expect(diagnostics.length).to.be.greaterThan(0);
            expect(statements[0]).to.exist;
        });
        it('unknown function type is not a problem in Brighterscript mode', () => {
            let { statements, diagnostics } = parse(`
                function log() as UNKNOWN_TYPE
                end function
            `, ParseMode.BrighterScript);
            expect(diagnostics.length).to.equal(0);
            expect(statements[0]).to.exist;
        });
        it('allows namespaced function type in Brighterscript mode', () => {
            let { statements, diagnostics } = parse(`
                function log() as SOME_NAMESPACE.UNKNOWN_TYPE
                end function
            `, ParseMode.BrighterScript);
            expect(diagnostics.length).to.equal(0);
            expect(statements[0]).to.exist;
        });
        it('allows custom parameter types in BrighterscriptMode', () => {
            let { statements, diagnostics } = parse(`
                sub foo(value as UNKNOWN_TYPE)
                end sub
            `, ParseMode.BrighterScript);
            expect(diagnostics.length).to.equal(0);
            expect(statements[0]).to.exist;
        });
        it('does not allow custom parameter types in Brightscript Mode', () => {
            let { diagnostics } = parse(`
                sub foo(value as UNKNOWN_TYPE)
                end sub
            `, ParseMode.BrightScript);
            expect(diagnostics.length).not.to.equal(0);
        });
        it('allows custom namespaced parameter types in BrighterscriptMode', () => {
            let { statements, diagnostics } = parse(`
                sub foo(value as SOME_NAMESPACE.UNKNOWN_TYPE)
                end sub
            `, ParseMode.BrighterScript);
            expect(diagnostics.length).to.equal(0);
            expect(statements[0]).to.exist;
        });

        it('works with conditionals', () => {
            expect(parse(`
                function printNumber()
                    if true then
                        print 1
                    else if true
                        return false
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
                let { diagnostics, statements } = Parser.parse(tokens);
                expect(diagnostics).to.be.lengthOf(0, 'Should have zero diagnostics');
                let fnSmt = statements[0];
                if (isFunctionStatement(fnSmt)) {
                    let ifStmt = fnSmt.func.body.statements[0];
                    if (isIfStatement(ifStmt)) {
                        expectCommentWithText(ifStmt.thenBranch.statements[0], `'comment 1`);
                        expectCommentWithText(ifStmt.thenBranch.statements[1], `'comment 2`);
                        expectCommentWithText(ifStmt.thenBranch.statements[3], `'comment 3`);

                        let elseIfBranch = ifStmt.elseBranch;
                        if (isIfStatement(elseIfBranch)) {
                            expectCommentWithText(elseIfBranch.thenBranch.statements[0], `'comment 4`);
                            expectCommentWithText(elseIfBranch.thenBranch.statements[1], `'comment 5`);
                            expectCommentWithText(elseIfBranch.thenBranch.statements[3], `'comment 6`);

                            let elseBranch = elseIfBranch.elseBranch;
                            if (isBlock(elseBranch)) {
                                expectCommentWithText(elseBranch.statements[0], `'comment 7`);
                                expectCommentWithText(elseBranch.statements[1], `'comment 8`);
                                expectCommentWithText(elseBranch.statements[3], `'comment 9`);
                            } else {
                                failStatementType(elseBranch, 'Block');
                            }

                        } else {
                            failStatementType(elseIfBranch, 'If');
                        }
                        expectCommentWithText(fnSmt.func.body.statements[1], `'comment 10`);
                    } else {
                        failStatementType(ifStmt, 'If');
                    }
                } else {
                    failStatementType(fnSmt, 'Function');
                }
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
            expect(diagnostics).to.be.length.greaterThan(0);
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

        it('catches missing file path', () => {
            let { statements, diagnostics } = parse(`
                import
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).to.equal(
                DiagnosticMessages.expectedStringLiteralAfterKeyword('import').message
            );
            expect(statements[0]).to.be.instanceof(ImportStatement);
        });
    });

    describe('Annotations', () => {
        it('parses with error if malformed', () => {
            let { diagnostics } = parse(`
                @
                sub main()
                end sub
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).to.equal(DiagnosticMessages.unexpectedToken('@').message);
        });

        it('properly handles empty annotation above class method', () => {
            //this code used to cause an infinite loop, so the fact that the test passes/fails on its own is a success!
            let { diagnostics } = parse(`
                class Person
                    @
                    sub new()
                    end sub
                end class
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).to.equal(DiagnosticMessages.expectedIdentifier().message);
        });

        it('parses with error if annotation is not followed by a statement', () => {
            let { diagnostics } = parse(`
                sub main()
                    @meta2
                end sub
                class MyClass
                    @meta3
                    @meta4
                end class
                @meta1
            `, ParseMode.BrighterScript);
            expect(diagnostics.length).to.equal(4);
            expect(diagnostics[0]?.message).to.equal(
                DiagnosticMessages.unusedAnnotation().message
            );
            expect(diagnostics[1]?.message).to.equal(
                DiagnosticMessages.unusedAnnotation().message
            );
            expect(diagnostics[2]?.message).to.equal(
                DiagnosticMessages.unusedAnnotation().message
            );
            expect(diagnostics[3]?.message).to.equal(
                DiagnosticMessages.unusedAnnotation().message
            );
        });

        it('attaches an annotation to next statement', () => {
            let { statements, diagnostics } = parse(`
                @meta1
                function main()
                end function

                @meta2 sub init()
                end sub
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            expect(statements[0]).to.be.instanceof(FunctionStatement);
            let fn = statements[0] as FunctionStatement;
            expect(fn.annotations).to.exist;
            expect(fn.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations[0].nameToken.text).to.equal('meta1');
            expect(fn.annotations[0].name).to.equal('meta1');

            expect(statements[1]).to.be.instanceof(FunctionStatement);
            fn = statements[1] as FunctionStatement;
            expect(fn.annotations).to.exist;
            expect(fn.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations[0].nameToken.text).to.equal('meta2');
        });

        it('attaches annotations inside a function body', () => {
            let { statements, diagnostics } = parse(`
                function main()
                    @meta1
                    print "hello"
                end function
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            let fn = statements[0] as FunctionStatement;
            let fnStatements = fn.func.body.statements;
            let stat = fnStatements[0];
            expect(stat).to.exist;
            expect(stat.annotations?.length).to.equal(1);
            expect(stat.annotations[0]).to.be.instanceof(AnnotationExpression);
        });

        it('attaches multiple annotations to next statement', () => {
            let { statements, diagnostics } = parse(`
                @meta1
                @meta2 @meta3
                function main()
                end function
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            expect(statements[0]).to.be.instanceof(FunctionStatement);
            let fn = statements[0] as FunctionStatement;
            expect(fn.annotations).to.exist;
            expect(fn.annotations.length).to.equal(3);
            expect(fn.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations[1]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations[2]).to.be.instanceof(AnnotationExpression);
        });

        it('allows annotations with parameters', () => {
            let { statements, diagnostics } = parse(`
                @meta1("arg", 2, true, { prop: "value" })
                function main()
                end function
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            let fn = statements[0] as FunctionStatement;
            expect(fn.annotations).to.exist;
            expect(fn.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations[0].nameToken.text).to.equal('meta1');
            expect(fn.annotations[0].call).to.be.instanceof(CallExpression);
        });

        it('attaches annotations to a class', () => {
            let { statements, diagnostics } = parse(`
                @meta1
                class MyClass
                    function main()
                        print "hello"
                    end function
                end class
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            let cs = statements[0] as ClassStatement;
            expect(cs.annotations?.length).to.equal(1);
            expect(cs.annotations[0]).to.be.instanceof(AnnotationExpression);
        });

        it('attaches annotations to multiple clases', () => {
            let { statements, diagnostics } = parse(`
                @meta1
                class MyClass
                    function main()
                        print "hello"
                    end function
                end class
                @meta2
                class MyClass2
                    function main()
                        print "hello"
                    end function
                end class
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            let cs = statements[0] as ClassStatement;
            expect(cs.annotations?.length).to.equal(1);
            expect(cs.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(cs.annotations[0].name).to.equal('meta1');
            let cs2 = statements[1] as ClassStatement;
            expect(cs2.annotations?.length).to.equal(1);
            expect(cs2.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(cs2.annotations[0].name).to.equal('meta2');
        });

        it('attaches annotations to a namespaced class', () => {
            let { statements, diagnostics } = parse(`
                namespace ns
                    @meta1
                    class MyClass
                        function main()
                            print "hello"
                        end function
                    end class
                end namespace
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            let ns = statements[0] as NamespaceStatement;
            let cs = ns.body.statements[0] as ClassStatement;
            expect(cs.annotations?.length).to.equal(1);
            expect(cs.annotations[0]).to.be.instanceof(AnnotationExpression);
        });

        it('attaches annotations to a namespaced class - multiple', () => {
            let { statements, diagnostics } = parse(`
                namespace ns
                    @meta1
                    class MyClass
                        function main()
                            print "hello"
                        end function
                    end class
                    @meta2
                    class MyClass2
                        function main()
                            print "hello"
                        end function
                    end class
                end namespace
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            let ns = statements[0] as NamespaceStatement;
            let cs = ns.body.statements[0] as ClassStatement;
            expect(cs.annotations?.length).to.equal(1);
            expect(cs.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(cs.annotations[0].name).to.equal('meta1');
            let cs2 = ns.body.statements[1] as ClassStatement;
            expect(cs2.annotations?.length).to.equal(1);
            expect(cs2.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(cs2.annotations[0].name).to.equal('meta2');

        });

        it('attaches annotations to a class constructor', () => {
            let { statements, diagnostics } = parse(`
                class MyClass
                    @meta1
                    function new()
                        print "hello"
                    end function
                    function methodA()
                        print "hello"
                    end function
                end class
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            let cs = statements[0] as ClassStatement;
            let stat = cs.body[0];
            expect(stat.annotations?.length).to.equal(1);
            expect(stat.annotations[0]).to.be.instanceof(AnnotationExpression);
        });

        it('attaches annotations to a class methods', () => {
            let { statements, diagnostics } = parse(`
                class MyClass
                    function new()
                        print "hello"
                    end function
                    @meta1
                    function methodA()
                        print "hello"
                    end function
                end class
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            let cs = statements[0] as ClassStatement;
            let stat = cs.body[1];
            expect(stat.annotations?.length).to.equal(1);
            expect(stat.annotations[0]).to.be.instanceof(AnnotationExpression);
        });
        it('attaches annotations to a class methods, fields and constructor', () => {
            let { statements, diagnostics } = parse(`
                @meta2
                @meta1
                class MyClass
                    @meta3
                    @meta4
                    function new()
                        print "hello"
                    end function
                    @meta5
                    @meta6
                    function methodA()
                        print "hello"
                    end function

                    @meta5
                    @meta6
                    public foo="bar"
                end class
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            let cs = statements[0] as ClassStatement;
            expect(cs.annotations?.length).to.equal(2);
            expect(cs.annotations[0]).to.be.instanceof(AnnotationExpression);
            let stat1 = cs.body[0];
            let stat2 = cs.body[1];
            let f1 = cs.body[2];
            expect(stat1.annotations?.length).to.equal(2);
            expect(stat1.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(stat2.annotations?.length).to.equal(2);
            expect(stat2.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(f1.annotations?.length).to.equal(2);
            expect(f1.annotations[0]).to.be.instanceof(AnnotationExpression);
        });

        it('ignores annotations on commented out lines', () => {
            let { statements, diagnostics } = parse(`
                '@meta1
                '   @meta1
                function new()
                    print "hello"
                end function
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            let cs = statements[0] as ClassStatement;
            expect(cs.annotations).to.be.undefined;
        });

        it('can convert argument of an annotation to JS types', () => {
            let { statements, diagnostics } = parse(`
                @meta1
                function main()
                end function

                @meta2(
                    "arg", 2, true,
                    { prop: "value" }, [1, 2],
                    sub()
                    end sub
                )
                sub init()
                end sub
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            expect(statements[0]).to.be.instanceof(FunctionStatement);
            let fn = statements[0] as FunctionStatement;
            expect(fn.annotations).to.exist;
            expect(fn.annotations[0].getArguments()).to.deep.equal([]);

            expect(statements[1]).to.be.instanceof(FunctionStatement);
            fn = statements[1] as FunctionStatement;
            expect(fn.annotations).to.exist;
            expect(fn.annotations[0]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations[0].getArguments()).to.deep.equal([
                'arg', 2, true,
                { prop: 'value' }, [1, 2],
                null
            ]);
            let allArgs = fn.annotations[0].getArguments(false);
            expect(allArgs.pop()).to.be.instanceOf(FunctionExpression);
        });

        it('can handle negative numbers', () => {
            let { statements, diagnostics } = parse(`
                @meta(-100)
                function main()
                end function

                sub init()
                end sub
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            expect(statements[0]).to.be.instanceof(FunctionStatement);
            let fn = statements[0] as FunctionStatement;
            expect(fn.annotations).to.exist;
            expect(fn.annotations[0].getArguments()).to.deep.equal([-100]);
        });
    });

    describe('getBscTypeFromExpression', () => {
        it('computes void type for sub with no return type', () => {
            const parser = parse(`
                sub main()
                    getMessage = sub()
                        print "hello"
                    end sub
                end sub
            `);
            const func = (parser.ast.statements[0] as FunctionStatement).func;
            const type = getBscTypeFromExpression((func.body.statements[0] as AssignmentStatement).value, func) as FunctionType;
            expect(type.returnType).to.be.instanceof(VoidType);
        });

        it('computes return type for sub with explicit return type', () => {
            const parser = parse(`
                sub main()
                    getMessage = sub() as string
                        return "hello"
                    end sub
                end sub
            `);
            const func = (parser.ast.statements[0] as FunctionStatement).func;
            const type = getBscTypeFromExpression((func.body.statements[0] as AssignmentStatement).value, func) as FunctionType;
            expect(type.returnType).to.be.instanceof(StringType);
        });

        it('supports sub with custom return type', () => {
            const parser = parse(`
                sub main()
                    getPerson = sub() as Person
                        return new Person()
                    end sub
                end sub

                class Person
                end class
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(parser.diagnostics);
            const func = (parser.ast.statements[0] as FunctionStatement).func;
            const type = getBscTypeFromExpression((func.body.statements[0] as AssignmentStatement).value, func) as FunctionType;
            // Return type is LazyType, because "Person" is not fully known yet
            expect(type.returnType).to.be.instanceof(LazyType);
        });

        it('supports function with array return type', () => {
            const parser = parse(`
                sub main()
                    getNums = sub() as integer[]
                        return [1,2,3]
                    end sub
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(parser.diagnostics);
            const func = (parser.ast.statements[0] as FunctionStatement).func;
            const type = getBscTypeFromExpression((func.body.statements[0] as AssignmentStatement).value, func) as FunctionType;
            expect(type.returnType).to.be.instanceof(ArrayType);
            expect((type.returnType as ArrayType).defaultType).to.be.instanceof(IntegerType);
        });
    });

    describe('symbolTable', () => {
        it('stores the types', () => {
            const parser = parse(`
                sub main()
                    someNum = 123
                    someString = "hello world"
                    someObj = {foo: "bar"}
                    someCustom = new CustomKlass()
                end sub

                class CustomKlass
                end class
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(parser.diagnostics);
            const mainSymbolTable = parser.references.functionExpressions[0].symbolTable;
            expect(mainSymbolTable.getSymbolType('someNum')).to.be.instanceof(IntegerType);
            expect(mainSymbolTable.getSymbolType('someString')).to.be.instanceof(StringType);
            expect(mainSymbolTable.getSymbolType('someObj')).to.be.instanceof(ObjectType);
            expect(mainSymbolTable.getSymbolType('someCustom')).to.be.instanceof(CustomType);
        });

        it('stores typed parameters in functions', () => {
            const parser = parse(`
                sub someFunc(param1 as string, param2 as integer)
                    temp = param2
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(parser.diagnostics);
            const someFuncSymbolTable = parser.references.functionExpressions[0].symbolTable;
            expect(someFuncSymbolTable.getSymbolType('param1')).to.be.instanceof(StringType);
            expect(someFuncSymbolTable.getSymbolType('param2')).to.be.instanceof(IntegerType);
            expect(someFuncSymbolTable.getSymbolType('temp')).to.be.instanceof(IntegerType);
        });

        it('properly defers typing lazy types', () => {
            const parser = parse(`
                sub someFunc()
                    temp = foo()
                end sub

                function foo() as string
                    return "foo"
                end function
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(parser.diagnostics);
            const someFuncSymbolTable = parser.references.functionExpressions[0].symbolTable;
            expect(isLazyType(someFuncSymbolTable.getSymbol('temp')[0].type)).to.be.true;
            expect(someFuncSymbolTable.getSymbolType('temp').toTypeString()).to.eq('string');
        });

        it('does not know about symbols declared in parent functions', () => {
            const parser = parse(`
                sub main()
                    count = 0
                    addOne = sub()
                        oldVal = count
                    end sub
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(parser.diagnostics);
            const addOneSymbolTable = parser.references.functionExpressions[0].childFunctionExpressions[0].symbolTable;
            expect(isUninitializedType(addOneSymbolTable.getSymbolType('oldVal'))).to.be.true;
        });

        it('finds params', () => {
            const parser = parse(`
                sub alert(p1, p2 as string, p3 = 1)
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(parser.diagnostics);
            expectSymbolTableEquals(parser.references.functionExpressions[0].symbolTable, [
                ['p1', new DynamicType(), util.createRange(1, 26, 1, 28)],
                ['p2', new StringType(), util.createRange(1, 30, 1, 32)],
                ['p3', new IntegerType(), util.createRange(1, 44, 1, 46)]
            ]);
        });

        describe('loops', () => {
            it('stores the loop variable in a for loop', () => {
                const parser = parse(`
                sub main()
                    for i = 0 to 10 step 10
                      print i
                    end for
                end sub
                `, ParseMode.BrighterScript);
                expectZeroDiagnostics(parser.diagnostics);
                const currentSymbolTable = parser.references.functionExpressions[0].symbolTable;
                expect(isIntegerType(currentSymbolTable.getSymbolType('i'))).to.be.true;
            });


            it('stores the loop variable in a for each loop', () => {
                const parser = parse(`
                sub doLoop(someData)
                    for each datum in someData
                      print datum
                    end for
                end sub
                `, ParseMode.BrighterScript);
                expectZeroDiagnostics(parser.diagnostics);
                const currentSymbolTable = parser.references.functionExpressions[0].symbolTable;
                expect(isDynamicType(currentSymbolTable.getSymbolType('datum'))).to.be.true;
            });

            it('determines the type of the variable in a for each if the target is an array literal', () => {
                const parser = parse(`
                    sub doLoop()
                        someData = [1,2,3]
                        for each datum in someData
                        print datum
                        end for
                    end sub
                `, ParseMode.BrighterScript);
                expectZeroDiagnostics(parser.diagnostics);
                const currentSymbolTable = parser.references.functionExpressions[0].symbolTable;
                expect(isIntegerType(currentSymbolTable.getSymbolType('datum'))).to.be.true;
            });

            it('determines the type of the variable in a for each if the target is an array', () => {
                const parser = parse(`
                    sub doLoop(someData as integer[])
                        for each datum in someData
                        print datum
                        end for
                    end sub
                `, ParseMode.BrighterScript);
                expectZeroDiagnostics(parser.diagnostics);
                const currentSymbolTable = parser.references.functionExpressions[0].symbolTable;
                expect(isIntegerType(currentSymbolTable.getSymbolType('datum'))).to.be.true;
            });

            it('determines the type of the variable in a for each if the target is an array of some custom type', () => {
                const parser = parse(`
                    sub doLoop(someData as MyKlass[])
                        for each datum in someData
                        print datum.name
                        end for
                    end sub

                    class MyKlass
                        name as string
                    end class
                `, ParseMode.BrighterScript);
                expectZeroDiagnostics(parser.diagnostics);
                const currentSymbolTable = parser.references.functionExpressions[0].symbolTable;
                expect(isLazyType(currentSymbolTable.getSymbol('datum')[0].type)).to.be.true;
            });
        });

    });

    describe('tokenChain', () => {
        it('can find a chain of tokens', () => {
            const parser = parse(`
            sub someFunc()
                print m.field.childField
            end sub
            `, ParseMode.BrighterScript);
            const childFieldToken = parser.getTokenAt(Position.create(2, 38));
            const tokenChain = parser.getTokenChain(childFieldToken).chain;
            const tokenChainTokens = tokenChain.map(tcm => tcm.token);
            expect(tokenChain.length).to.equal(3);
            expect(tokenChainTokens.map(token => token.text)).to.eql(['m', 'field', 'childField']);
            expect(tokenChain.map(tcm => tcm.usage)).to.eql([TokenUsage.Direct, TokenUsage.Direct, TokenUsage.Direct]);
        });

        it('can find a chain of tokens with function call with no args in the middle', () => {
            const parser = parse(`
            sub someFunc()
                print var.field.funcCall().childField
            end sub
            `, ParseMode.BrighterScript);
            const childFieldToken = parser.getTokenAt(Position.create(2, 49));
            const tokenChain = parser.getTokenChain(childFieldToken).chain;
            const tokenChainTokens = tokenChain.map(tcm => tcm.token);
            expect(tokenChain.length).to.equal(4);
            expect(tokenChainTokens.map(token => token.text)).to.eql(['var', 'field', 'funcCall', 'childField']);
            expect(tokenChain[2].usage).to.eql(TokenUsage.Call);
        });

        it('can find a chain of tokens with function call with multiple args in the middle', () => {
            const parser = parse(`
            sub someFunc()
                print var.field.funcCall(1, "string", {key: value}).childField
            end sub
            `, ParseMode.BrighterScript);
            const childFieldToken = parser.getTokenAt(Position.create(2, 75));
            const tokenChain = parser.getTokenChain(childFieldToken).chain;
            const tokenChainTokens = tokenChain.map(tcm => tcm.token);
            expect(tokenChain.length).to.equal(4);
            expect(tokenChainTokens.map(token => token.text)).to.eql(['var', 'field', 'funcCall', 'childField']);
            expect(tokenChain[2].usage).to.eql(TokenUsage.Call);
        });

        it('can find a chain of tokens with function call with function call inside', () => {
            const parser = parse(`
            sub someFunc()
                print var.field.funcCall(a(), b(), otherFunc2(c(), {d: func3(e)})).childField
            end sub
            `, ParseMode.BrighterScript);
            const childFieldToken = parser.getTokenAt(Position.create(2, 90));
            const tokenChain = parser.getTokenChain(childFieldToken).chain;
            const tokenChainTokens = tokenChain.map(tcm => tcm.token);
            expect(tokenChain.length).to.equal(4);
            expect(tokenChainTokens.map(token => token.text)).to.eql(['var', 'field', 'funcCall', 'childField']);
            expect(tokenChain[2].usage).to.eql(TokenUsage.Call);
        });

        it('can find a chain of tokens with array references inside', () => {
            const parser = parse(`
            sub someFunc()
                print var.field.myArray[0].childField
            end sub
            `, ParseMode.BrighterScript);
            const childFieldToken = parser.getTokenAt(Position.create(2, 50));
            const tokenChain = parser.getTokenChain(childFieldToken).chain;
            const tokenChainTokens = tokenChain.map(tcm => tcm.token);
            expect(tokenChain.length).to.equal(4);
            expect(tokenChainTokens.map(token => token.text)).to.eql(['var', 'field', 'myArray', 'childField']);
            expect(tokenChain[2].usage).to.eql(TokenUsage.ArrayReference);
        });

        it('includes unknown when an expression in brackets is part of the chain', () => {
            const parser = parse(`
            sub someFunc()
                print (1 + 1).toStr()
            end sub
            `, ParseMode.BrighterScript);
            const toStrToken = parser.getTokenAt(Position.create(2, 34));
            const tokenChainResponse = parser.getTokenChain(toStrToken);
            expect(tokenChainResponse.includesUnknowableTokenType).to.be.true;
        });

        it('includes unknown when an expression in double brackets is part of the chain', () => {
            const parser = parse(`
            sub someFunc()
                print ((2 + 1)*3).toStr()
            end sub
            `, ParseMode.BrighterScript);
            const toStrToken = parser.getTokenAt(Position.create(2, 38));
            const tokenChainResponse = parser.getTokenChain(toStrToken);
            expect(tokenChainResponse.includesUnknowableTokenType).to.be.true;
        });

        it('includes unknown when a complicated expression in brackets is part of the chain', () => {
            const parser = parse(`
            sub someFunc(currentDate, lastUpdate)
                print (INT((currentDate.asSeconds() - lastUpdate) / 86400)).toStr()
            end sub
            `, ParseMode.BrighterScript);
            const toStrToken = parser.getTokenAt(Position.create(2, 81));
            const tokenChainResponse = parser.getTokenChain(toStrToken);
            expect(tokenChainResponse.includesUnknowableTokenType).to.be.true;
        });

    });

    it('includes unknown when property is referenced via brackets', () => {
        const parser = parse(`
            sub someFunc()
                complexObj = {prop: "hello", subObj: {prop: "foo", grandChildObj:{prop:"bar"}}}
                print complexObj.subObj.prop
                print complexObj["subObj"].prop
                print complexObj["subObj"]["grandChildObj"].prop
            end sub
            `, ParseMode.BrighterScript);
        const propAsChainToken = parser.getTokenAt(Position.create(3, 44)); // complexObj.subObj.prop
        const propAsAsBracketToken = parser.getTokenAt(Position.create(4, 47)); // complexObj["subObj"].prop
        const propAsAsDoubleBracketToken = parser.getTokenAt(Position.create(5, 64)); // complexObj["subObj"]["grandChildObj"].prop

        let tokenChainResponse = parser.getTokenChain(propAsChainToken);
        expect(tokenChainResponse.includesUnknowableTokenType).to.be.false;
        expect(tokenChainResponse.chain.map(tcm => tcm.token).map(token => token.text)).to.eql(['complexObj', 'subObj', 'prop']);

        tokenChainResponse = parser.getTokenChain(propAsAsBracketToken);
        expect(tokenChainResponse.includesUnknowableTokenType).to.be.false;
        expect(tokenChainResponse.chain[0].usage).to.eql(TokenUsage.ArrayReference);
        tokenChainResponse = parser.getTokenChain(propAsAsDoubleBracketToken);
        expect(tokenChainResponse.includesUnknowableTokenType).to.be.true;
    });

    it('allows token kinds from AllowedLocalIdentifiers as start of a chain', () => {
        const parser = parse(`
            sub testLocalIdentifiers(override, string, float)
                override.someProp.someFunc()
                string.someProp.someFunc()
                float.someProp.someFunc()
            end sub
            `, ParseMode.BrightScript);
        const overrideFuncToken = parser.getTokenAt(Position.create(2, 40)); // override.someProp.someFunc()
        const stringFuncToken = parser.getTokenAt(Position.create(3, 40)); // string.someProp.someFunc()
        const floatFuncToken = parser.getTokenAt(Position.create(4, 38)); // float.someProp.someFunc()

        let tokenChainResponse = parser.getTokenChain(overrideFuncToken);
        expect(tokenChainResponse.includesUnknowableTokenType).to.be.false;
        expect(tokenChainResponse.chain.map(tcm => tcm.token).map(token => token.text)).to.eql(['override', 'someProp', 'someFunc']);

        tokenChainResponse = parser.getTokenChain(stringFuncToken);
        expect(tokenChainResponse.includesUnknowableTokenType).to.be.false;
        expect(tokenChainResponse.chain.map(tcm => tcm.token).map(token => token.text)).to.eql(['string', 'someProp', 'someFunc']);

        tokenChainResponse = parser.getTokenChain(floatFuncToken);
        expect(tokenChainResponse.includesUnknowableTokenType).to.be.false;
        expect(tokenChainResponse.chain.map(tcm => tcm.token).map(token => token.text)).to.eql(['float', 'someProp', 'someFunc']);
    });

    it('allows token kinds from AllowedProperties in middle of a chain', () => {
        const parser = parse(`
            sub testAllowedProperties(someObj)
                someObj.override.someFunc()
                someObj.string.someFunc()
                someObj.float.someFunc()
            end sub
            `, ParseMode.BrightScript);
        const overrideFuncToken = parser.getTokenAt(Position.create(2, 36)); // someObj.override.someFunc()
        const stringFuncToken = parser.getTokenAt(Position.create(3, 36)); // someObj.string.someFunc()
        const floatFuncToken = parser.getTokenAt(Position.create(4, 36)); // someObj.float.someFunc()

        let tokenChainResponse = parser.getTokenChain(overrideFuncToken);
        expect(tokenChainResponse.includesUnknowableTokenType).to.be.false;
        expect(tokenChainResponse.chain.map(tcm => tcm.token).map(token => token.text)).to.eql(['someObj', 'override', 'someFunc']);

        tokenChainResponse = parser.getTokenChain(stringFuncToken);
        expect(tokenChainResponse.includesUnknowableTokenType).to.be.false;
        expect(tokenChainResponse.chain.map(tcm => tcm.token).map(token => token.text)).to.eql(['someObj', 'string', 'someFunc']);

        tokenChainResponse = parser.getTokenChain(floatFuncToken);
        expect(tokenChainResponse.includesUnknowableTokenType).to.be.false;
        expect(tokenChainResponse.chain.map(tcm => tcm.token).map(token => token.text)).to.eql(['someObj', 'float', 'someFunc']);

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

function expectCommentWithText(stat: Statement, text: string) {
    if (isCommentStatement(stat)) {
        expect(stat.text).to.equal(text);
    } else {
        failStatementType(stat, 'Comment');
    }
}

export function failStatementType(stat: Statement, type: string) {
    assert.fail(`Statement ${stat.constructor.name} line ${stat.range.start.line} is not a ${type}`);
}
