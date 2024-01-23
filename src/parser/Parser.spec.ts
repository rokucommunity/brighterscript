import { expect, assert } from '../chai-config.spec';
import { Lexer } from '../lexer/Lexer';
import { ReservedWords, TokenKind } from '../lexer/TokenKind';
import type { AAMemberExpression, BinaryExpression, TypeCastExpression, UnaryExpression } from './Expression';
import { TernaryExpression, NewExpression, IndexedGetExpression, DottedGetExpression, XmlAttributeGetExpression, CallfuncExpression, AnnotationExpression, CallExpression, FunctionExpression, VariableExpression } from './Expression';
import { Parser, ParseMode } from './Parser';
import type { AssignmentStatement, ClassStatement, InterfaceStatement, ReturnStatement } from './Statement';
import { PrintStatement, FunctionStatement, NamespaceStatement, ImportStatement } from './Statement';
import { Range } from 'vscode-languageserver';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { isAssignmentStatement, isBinaryExpression, isBlock, isCallExpression, isClassStatement, isCommentStatement, isDottedGetExpression, isExpressionStatement, isFunctionStatement, isGroupingExpression, isIfStatement, isIndexedGetExpression, isInterfaceStatement, isLiteralExpression, isNamespaceStatement, isPrintStatement, isTypeCastExpression, isUnaryExpression, isVariableExpression } from '../astUtils/reflection';
import { expectDiagnosticsIncludes, expectTypeToBe, expectZeroDiagnostics } from '../testHelpers.spec';
import { BrsTranspileState } from './BrsTranspileState';
import { SourceNode } from 'source-map';
import { BrsFile } from '../files/BrsFile';
import { Program } from '../Program';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { Expression, Statement } from './AstNode';
import { SymbolTypeFlag } from '../SymbolTable';
import { IntegerType } from '../types/IntegerType';
import { FloatType } from '../types/FloatType';
import { StringType } from '../types/StringType';
import { ArrayType, UnionType } from '../types';

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
            expect(parser.references.functionStatements.map(x => x.tokens.name.text)).to.eql([
                'main',
                'UnusedFunction'
            ]);
            //simulate a tree-shaking plugin by removing the `UnusedFunction`
            parser.ast.statements.splice(1);
            //tell the parser we modified the AST and need to regenerate references
            parser.invalidateReferences();
            expect(parser['_references']).not.to.exist;
            //calling `references` automatically regenerates the references
            expect(parser.references.functionStatements.map(x => x.tokens.name.text)).to.eql([
                'main'
            ]);
        });

        function expressionsToStrings(expressions: Set<Expression>) {
            return [...expressions.values()].map(x => {
                const file = new BrsFile({
                    srcPath: '',
                    destPath: '',
                    program: new Program({} as any)
                });
                const state = new BrsTranspileState(file);
                return new SourceNode(null, null, null, x.transpile(state)).toString();
            });
        }

        // eslint-disable-next-line func-names, prefer-arrow-callback
        it('works for references.expressions', function () {
            this.timeout(5000); // this test takes a long time on github
            const parser = Parser.parse(`
                b += "plus-equal"
                a += 1 + 2
                b += getValue1() + getValue2()
                increment++
                decrement--
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
                '"plus-equal"',
                'b',
                'b += "plus-equal"',
                '1',
                '2',
                'a',
                'a += 1 + 2',
                'getValue1()',
                'getValue2()',
                'b',
                'b += getValue1() + getValue2()',
                'increment++',
                'decrement--',
                //currently the "toString" does a transpile, so that's why this is different.
                'some.node.callfunc("doCallfunc", invalid)',
                '3',
                '4',
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
            ];

            expect(
                expressionsToStrings(parser.references.expressions)
            ).to.eql(expected);

            //tell the parser we modified the AST and need to regenerate references
            parser.invalidateReferences();

            expect(
                expressionsToStrings(parser.references.expressions).sort()
            ).to.eql(expected.sort());
        });

        it('works for references.expressions', () => {
            const parser = Parser.parse(`
                value = true or type(true) = "something" or Enums.A.Value = "value" and Enum1.Value = Name.Space.Enum2.Value
            `);
            const expected = [
                'true',
                'type(true)',
                '"something"',
                'true',
                'Enums.A.Value',
                '"value"',
                'Enum1.Value',
                'Name.Space.Enum2.Value',
                'true or type(true) = "something" or Enums.A.Value = "value" and Enum1.Value = Name.Space.Enum2.Value'
            ];

            expect(
                expressionsToStrings(parser.references.expressions)
            ).to.eql(expected);

            //tell the parser we modified the AST and need to regenerate references
            parser.invalidateReferences();

            expect(
                expressionsToStrings(parser.references.expressions).sort()
            ).to.eql(expected.sort());
        });

        it('works for logical expression', () => {
            const parser = Parser.parse(`
                value = Enums.A.Value = "value"
            `);
            const expected = [
                'Enums.A.Value',
                '"value"',
                'Enums.A.Value = "value"'
            ];

            expect(
                expressionsToStrings(parser.references.expressions)
            ).to.eql(expected);

            //tell the parser we modified the AST and need to regenerate references
            parser.invalidateReferences();

            expect(
                expressionsToStrings(parser.references.expressions).sort()
            ).to.eql(expected.sort());
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

    describe('optional chaining operator', () => {
        function getExpression<T>(text: string, options?: { matcher?: any; parseMode?: ParseMode }) {
            const parser = parse(text, options?.parseMode);
            expectZeroDiagnostics(parser);
            const expressions = [...parser.references.expressions];
            if (options?.matcher) {
                return expressions.find(options.matcher) as unknown as T;
            } else {
                return expressions[0] as unknown as T;
            }
        }
        it('works for ?.', () => {
            const expression = getExpression<DottedGetExpression>(`value = person?.name`);
            expect(expression).to.be.instanceOf(DottedGetExpression);
            expect(expression.tokens.dot.kind).to.eql(TokenKind.QuestionDot);
        });

        it('works for ?[', () => {
            const expression = getExpression<IndexedGetExpression>(`value = person?["name"]`, { matcher: isIndexedGetExpression });
            expect(expression).to.be.instanceOf(IndexedGetExpression);
            expect(expression.openingSquare.kind).to.eql(TokenKind.QuestionLeftSquare);
            expect(expression.questionDotToken).not.to.exist;
        });

        it('works for ?.[', () => {
            const expression = getExpression<IndexedGetExpression>(`value = person?.["name"]`, { matcher: isIndexedGetExpression });
            expect(expression).to.be.instanceOf(IndexedGetExpression);
            expect(expression.openingSquare.kind).to.eql(TokenKind.LeftSquareBracket);
            expect(expression.questionDotToken?.kind).to.eql(TokenKind.QuestionDot);
        });

        it('works for ?@', () => {
            const expression = getExpression<XmlAttributeGetExpression>(`value = someXml?@someAttr`);
            expect(expression).to.be.instanceOf(XmlAttributeGetExpression);
            expect(expression.at.kind).to.eql(TokenKind.QuestionAt);
        });

        it('works for ?(', () => {
            const expression = getExpression<CallExpression>(`value = person.getName?()`);
            expect(expression).to.be.instanceOf(CallExpression);
            expect(expression.openingParen.kind).to.eql(TokenKind.QuestionLeftParen);
        });

        it('works for print statements using question mark', () => {
            const { statements } = parse(`
                ?[1]
                ?(1+1)
            `);
            expect(statements[0]).to.be.instanceOf(PrintStatement);
            expect(statements[1]).to.be.instanceOf(PrintStatement);
        });

        //TODO enable this once we properly parse IIFEs
        it.skip('works for ?( in anonymous function', () => {
            const expression = getExpression<CallExpression>(`thing = (function() : end function)?()`);
            expect(expression).to.be.instanceOf(CallExpression);
            expect(expression.openingParen.kind).to.eql(TokenKind.QuestionLeftParen);
        });

        it('works for ?( in new call', () => {
            const expression = getExpression<NewExpression>(`thing = new Person?()`, { parseMode: ParseMode.BrighterScript });
            expect(expression).to.be.instanceOf(NewExpression);
            expect(expression.call.openingParen.kind).to.eql(TokenKind.QuestionLeftParen);
        });

        it('distinguishes between optional chaining and ternary expression', () => {
            const parser = parse(`
                sub main()
                    name = person?["name"]
                    isTrue = true
                    key = isTrue ? ["name"] : ["age"]
                end sub
            `, ParseMode.BrighterScript);
            expect(parser.references.assignmentStatements[0].value).is.instanceof(IndexedGetExpression);
            expect(parser.references.assignmentStatements[2].value).is.instanceof(TernaryExpression);
        });

        it('distinguishes between optional chaining and ternary expression', () => {
            const parser = parse(`
                sub main()
                    'optional chain. the lack of whitespace between ? and [ matters
                    key = isTrue ?["name"] : getDefault()
                    'ternary
                    key = isTrue ? ["name"] : getDefault()
                end sub
            `, ParseMode.BrighterScript);
            expect(parser.references.assignmentStatements[0].value).is.instanceof(IndexedGetExpression);
            expect(parser.references.assignmentStatements[1].value).is.instanceof(TernaryExpression);
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

        it('does not scrap the entire function when encountering unknown parameter type', () => {
            const parser = parse(`
                sub test(param1 as unknownType)
                end sub
            `);
            // type validation happens at scope validation, not at the parser
            expectZeroDiagnostics(parser);
            expect(
                isFunctionStatement(parser.ast.statements[0])
            ).to.be.true;
        });

        describe('namespace', () => {
            it('allows namespaces declared inside other namespaces', () => {
                const parser = parse(`
                    namespace Level1
                        namespace Level2.Level3
                            sub main()
                            end sub
                        end namespace
                    end namespace
                `, ParseMode.BrighterScript);
                expectZeroDiagnostics(parser);
                // We expect these names to be "as given" in this context, because we aren't evaluating a full program.
                expect(parser.references.namespaceStatements.map(statement => statement.getName(ParseMode.BrighterScript))).to.deep.equal([
                    'Level1.Level2.Level3',
                    'Level1'
                ]);
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
            `, ParseMode.BrightScript);
            expectZeroDiagnostics(diagnostics); // type validation happens at scope validation step
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
        it('does not cause any diagnostics when custom parameter types are used in Brightscript Mode', () => {
            let { diagnostics } = parse(`
                sub foo(value as UNKNOWN_TYPE)
                end sub
            `, ParseMode.BrightScript);
            expect(diagnostics.length).to.equal(0);
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

        it('allows printing object with trailing period', () => {
            let { tokens } = Lexer.scan(`print a.`);
            let { diagnostics, statements } = Parser.parse(tokens);
            let printStatement = statements[0] as PrintStatement;
            expectDiagnosticsIncludes(diagnostics, DiagnosticMessages.expectedPropertyNameAfterPeriod());
            expect(printStatement).to.be.instanceof(PrintStatement);
            expect(printStatement.expressions[0]).to.be.instanceof(VariableExpression);
        });

        it('allows printing object with trailing period with multiple dotted gets', () => {
            let { tokens } = Lexer.scan(`print a.b.`);
            let { diagnostics, statements } = Parser.parse(tokens);
            let printStatement = statements[0] as PrintStatement;
            expectDiagnosticsIncludes(diagnostics, DiagnosticMessages.expectedPropertyNameAfterPeriod());
            expect(printStatement).to.be.instanceof(PrintStatement);
            expect(printStatement.expressions[0]).to.be.instanceof(DottedGetExpression);
        });

        describe('incomplete statements in the ast', () => {
            it('adds variable expressions to the ast', () => {
                let { tokens } = Lexer.scan(`
                    function a()
                        NameA.
                    end function

                    namespace NameA
                        sub noop()
                        end sub
                    end namespace
                `);
                let { diagnostics, statements } = Parser.parse(tokens) as any;
                expectDiagnosticsIncludes(diagnostics, DiagnosticMessages.expectedStatementOrFunctionCallButReceivedExpression());
                let stmt = statements[0].func.body.statements[0];

                expect(isExpressionStatement(stmt)).to.be.true;
                expect(isVariableExpression((stmt).expression)).to.be.true;
                expect(stmt.expression.name.text).to.equal('NameA');
            });

            it('adds unended call statements', () => {
                let { tokens } = Lexer.scan(`
                    function a()
                        lcase(
                    end function
                `);
                let { statements } = Parser.parse(tokens) as any;
                let stmt = statements[0].func.body.statements[0];

                expect(isExpressionStatement(stmt)).to.be.true;
                expect(isCallExpression((stmt).expression)).to.be.true;
                expect(stmt.expression.callee.name.text).to.equal('lcase');
            });

            it('adds unended indexed get statements', () => {
                let { tokens } = Lexer.scan(`
                    function a()
                        nums[
                    end function

                    const nums = [1, 2, 3]
                `);
                let { statements } = Parser.parse(tokens) as any;
                let stmt = statements[0].func.body.statements[0];

                expect(isExpressionStatement(stmt)).to.be.true;
                expect(isIndexedGetExpression((stmt).expression)).to.be.true;
                expect(stmt.expression.obj.name.text).to.equal('nums');
            });

            it('adds dotted gets', () => {
                let { tokens } = Lexer.scan(`
                    function foo(a as KlassA)
                        a.b.
                    end function

                    class KlassA
                        b as KlassB
                    end class

                    class KlassB
                        sub noop()
                        end sub
                    end class
                `);
                let { statements } = Parser.parse(tokens) as any;
                let stmt = statements[0].func.body.statements[0];

                expect(isExpressionStatement(stmt)).to.be.true;
                expect(isDottedGetExpression((stmt).expression)).to.be.true;
                expect(stmt.expression.obj.name.text).to.equal('a');
                expect(stmt.expression.name.text).to.equal('b');
            });

            it('adds function statement with missing type after as', () => {
                let parser = parse(`
                    sub foo(thing as  )
                        print thing
                    end sub
                `, ParseMode.BrighterScript);
                expect(parser.diagnostics[0]?.message).to.exist;
                expect(parser.ast.statements[0]).to.be.instanceof(FunctionStatement);
            });
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

                        let elseIfBranch = ifStmt.elseBranch!;
                        if (isIfStatement(elseIfBranch)) {
                            expectCommentWithText(elseIfBranch.thenBranch.statements[0], `'comment 4`);
                            expectCommentWithText(elseIfBranch.thenBranch.statements[1], `'comment 5`);
                            expectCommentWithText(elseIfBranch.thenBranch.statements[3], `'comment 6`);

                            let elseBranch = elseIfBranch.elseBranch!;
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

            it('allows `mod` as an AA literal property', () => {
                const parser = parse(`
                    sub main()
                        person = {
                            mod: true
                        }
                        person.mod = false
                        print person.mod
                    end sub
                `);
                expectZeroDiagnostics(parser);
            });

            it('converts aa literal property TokenKind to Identifier', () => {
                const parser = parse(`
                    sub main()
                        person = {
                            mod: true
                            and: true
                        }
                    end sub
                `);
                expectZeroDiagnostics(parser);
                const elements = [] as AAMemberExpression[];
                parser.ast.walk(createVisitor({
                    AAMemberExpression: (node) => {
                        elements.push(node as any);
                    }
                }), {
                    walkMode: WalkMode.visitAllRecursive
                });

                expect(
                    elements.map(x => x.keyToken.kind)
                ).to.eql(
                    [TokenKind.Identifier, TokenKind.Identifier]
                );
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
            expect(fn.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations![0].nameToken.text).to.equal('meta1');
            expect(fn.annotations![0].name).to.equal('meta1');

            expect(statements[1]).to.be.instanceof(FunctionStatement);
            fn = statements[1] as FunctionStatement;
            expect(fn.annotations).to.exist;
            expect(fn.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations![0].nameToken.text).to.equal('meta2');
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
            expect(stat.annotations![0]).to.be.instanceof(AnnotationExpression);
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
            expect(fn.annotations!.length).to.equal(3);
            expect(fn.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations![1]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations![2]).to.be.instanceof(AnnotationExpression);
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
            expect(fn.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations![0].nameToken.text).to.equal('meta1');
            expect(fn.annotations![0].call).to.be.instanceof(CallExpression);
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
            expect(cs.annotations![0]).to.be.instanceof(AnnotationExpression);
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
            expect(cs.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(cs.annotations![0].name).to.equal('meta1');
            let cs2 = statements[1] as ClassStatement;
            expect(cs2.annotations?.length).to.equal(1);
            expect(cs2.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(cs2.annotations![0].name).to.equal('meta2');
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
            expect(cs.annotations![0]).to.be.instanceof(AnnotationExpression);
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
            expect(cs.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(cs.annotations![0].name).to.equal('meta1');
            let cs2 = ns.body.statements[1] as ClassStatement;
            expect(cs2.annotations?.length).to.equal(1);
            expect(cs2.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(cs2.annotations![0].name).to.equal('meta2');

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
            expect(stat.annotations![0]).to.be.instanceof(AnnotationExpression);
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
            expect(stat.annotations![0]).to.be.instanceof(AnnotationExpression);
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
            expect(cs.annotations![0]).to.be.instanceof(AnnotationExpression);
            let stat1 = cs.body[0];
            let stat2 = cs.body[1];
            let f1 = cs.body[2];
            expect(stat1.annotations?.length).to.equal(2);
            expect(stat1.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(stat2.annotations?.length).to.equal(2);
            expect(stat2.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(f1.annotations?.length).to.equal(2);
            expect(f1.annotations![0]).to.be.instanceof(AnnotationExpression);
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
            expect(fn.annotations![0].getArguments()).to.deep.equal([]);

            expect(statements[1]).to.be.instanceof(FunctionStatement);
            fn = statements[1] as FunctionStatement;
            expect(fn.annotations).to.exist;
            expect(fn.annotations![0]).to.be.instanceof(AnnotationExpression);
            expect(fn.annotations![0].getArguments()).to.deep.equal([
                'arg', 2, true,
                { prop: 'value' }, [1, 2],
                null
            ]);
            let allArgs = fn.annotations![0].getArguments(false);
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
            expect(fn.annotations![0].getArguments()).to.deep.equal([-100]);
        });
    });

    describe('type casts', () => {

        it('is not allowed in brightscript mode', () => {
            let parser = parse(`
                sub main(node as dynamic)
                    print lcase((node as string))
                end sub
            `, ParseMode.BrightScript);
            expect(
                parser.diagnostics[0]?.message
            ).to.equal(
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('type cast').message
            );
        });

        it('allows type casts after function calls', () => {
            let { statements, diagnostics } = parse(`
                sub main()
                    value = getValue() as integer
                end sub

                function getValue()
                    return 123
                end function
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            expect(statements[0]).to.be.instanceof(FunctionStatement);
            let fn = statements[0] as FunctionStatement;
            expect(fn.func.body.statements).to.exist;
            let assignment = fn.func.body.statements[0] as AssignmentStatement;
            expect(isAssignmentStatement(assignment)).to.be.true;
            expect(isTypeCastExpression(assignment.value)).to.be.true;
            expect(isCallExpression((assignment.value as TypeCastExpression).obj)).to.be.true;
            expectTypeToBe(assignment.getType({ flags: SymbolTypeFlag.typetime }), IntegerType);
        });

        it('allows type casts in the middle of expressions', () => {
            let { statements, diagnostics } = parse(`
                sub main()
                    value = (getValue() as integer).toStr()
                end sub

                function getValue()
                    return 123
                end function
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            expect(statements[0]).to.be.instanceof(FunctionStatement);
            let fn = statements[0] as FunctionStatement;
            expect(fn.func.body.statements).to.exist;
            let assignment = fn.func.body.statements[0] as any;
            expect(isAssignmentStatement(assignment)).to.be.true;
            expect(isCallExpression(assignment.value)).to.be.true;
            expect(isDottedGetExpression(assignment.value.callee)).to.be.true;
            expect(isGroupingExpression(assignment.value.callee.obj)).to.be.true;
            expect(isTypeCastExpression(assignment.value.callee.obj.expression)).to.be.true;
            //grouping expression is an integer
            expectTypeToBe(assignment.value.callee.obj.getType({ flags: SymbolTypeFlag.typetime }), IntegerType);
        });

        it('allows type casts in a function call', () => {
            let { statements, diagnostics } = parse(`
                sub main()
                    print cos(getAngle() as float)
                end sub

                function getAngle()
                    return 123
                end function
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            expect(statements[0]).to.be.instanceof(FunctionStatement);
            let fn = statements[0] as FunctionStatement;
            expect(fn.func.body.statements).to.exist;
            let print = fn.func.body.statements[0] as any;
            expect(isPrintStatement(print)).to.be.true;
            expect(isCallExpression(print.expressions[0])).to.be.true;
            let fnCall = print.expressions[0] as CallExpression;
            expect(isTypeCastExpression(fnCall.args[0])).to.be.true;
            let arg = fnCall.args[0] as TypeCastExpression;
            //argument type is float
            expectTypeToBe(arg.getType({ flags: SymbolTypeFlag.typetime }), FloatType);
        });

        it('allows multiple type casts', () => {
            let { statements, diagnostics } = parse(`
                sub main()
                    print getData() as dynamic as float as string
                end sub
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).not.to.exist;
            expect(statements[0]).to.be.instanceof(FunctionStatement);
            let fn = statements[0] as FunctionStatement;
            expect(fn.func.body.statements).to.exist;
            let print = fn.func.body.statements[0] as any;
            expect(isPrintStatement(print)).to.be.true;
            expect(isTypeCastExpression(print.expressions[0])).to.be.true;
            //argument type is float
            expectTypeToBe(print.expressions[0].getType({ flags: SymbolTypeFlag.typetime }), StringType);
        });

        it('flags invalid type cast syntax - multiple as', () => {
            let { diagnostics } = parse(`
                sub foo(key)
                    getData(key as as string)
                end sub
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).to.exist;
        });

        it('flags invalid type cast syntax - no type after as', () => {
            let { diagnostics } = parse(`
                sub foo(key)
                    getData(key as)
                end sub
            `, ParseMode.BrighterScript);
            expect(diagnostics[0]?.message).to.exist;
        });
    });

    describe('union types', () => {

        it('is not allowed in brightscript mode', () => {
            let parser = parse(`
                sub main(param as string or integer)
                    print param
                end sub
            `, ParseMode.BrightScript);
            expectDiagnosticsIncludes(parser.diagnostics, [DiagnosticMessages.expectedStatementOrFunctionCallButReceivedExpression()]);
        });

        it('allows union types in parameters', () => {
            let { diagnostics } = parse(`
                sub main(param as string or integer)
                    print param
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
        });

        it('allows union types in type casts', () => {
            let { diagnostics } = parse(`
                sub main(val)
                    printThing(val as string or integer)
                end sub

                sub printThing(thing as string or integer)
                    print thing
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
        });
    });

    describe('typed arrays', () => {

        it('is not allowed in brightscript mode', () => {
            let parser = parse(`
                sub main(things as string[])
                    print things
                end sub
            `, ParseMode.BrightScript);
            expectDiagnosticsIncludes(parser.diagnostics,
                [DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('typed arrays')]
            );
        });


        it('is allowed in brighterscript mode', () => {
            let { statements, diagnostics } = parse(`
                sub main(things as string[])
                    print things
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            const paramType = (statements[0] as FunctionStatement).func.parameters[0].getType({ flags: SymbolTypeFlag.typetime });
            expectTypeToBe(paramType, ArrayType);
            expectTypeToBe((paramType as ArrayType).defaultType, StringType);
        });

        it('allows multi dimensional arrays', () => {
            let { statements, diagnostics } = parse(`
                sub main(things as string[][])
                    print things
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            const paramType = (statements[0] as FunctionStatement).func.parameters[0].getType({ flags: SymbolTypeFlag.typetime });
            expectTypeToBe(paramType, ArrayType);
            expectTypeToBe((paramType as ArrayType).defaultType, ArrayType);
            expectTypeToBe(((paramType as ArrayType).defaultType as ArrayType).defaultType, StringType);
        });

        it('allows arrays as return types', () => {
            let { statements, diagnostics } = parse(`
                function getFourPrimes() as integer[]
                    return [2, 3, 5, 7]
                end function
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            const paramType = (statements[0] as FunctionStatement).func.returnTypeExpression.getType({ flags: SymbolTypeFlag.typetime });
            expectTypeToBe(paramType, ArrayType);
            expectTypeToBe((paramType as ArrayType).defaultType, IntegerType);
        });

        it('allows arrays in union types', () => {
            let { statements, diagnostics } = parse(`
                sub foo(x as integer or integer[] or string or string[])
                  print x
                end sub
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            const paramType = (statements[0] as FunctionStatement).func.parameters[0].getType({ flags: SymbolTypeFlag.typetime });
            expectTypeToBe(paramType, UnionType);
            expect(paramType.toString().includes('Array<string>')).to.be.true;
            expect(paramType.toString().includes('Array<integer>')).to.be.true;
        });

    });

    describe('interfaces', () => {

        it('allows fields and methods', () => {
            let { statements, diagnostics } = parse(`
                interface SomeIFace
                    name as string
                    height as integer
                    function getValue(thing as float) as object
                    function getMe() as SomeIFace
                    sub noop()
                end interface
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isInterfaceStatement(statements[0])).to.be.true;
        });

        it('allows untyped fields', () => {
            let { statements, diagnostics } = parse(`
                interface HasUntyped
                    name
                end interface
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isInterfaceStatement(statements[0])).to.be.true;
        });

        it('allows optional fields', () => {
            let { statements, diagnostics } = parse(`
                interface HasOptional
                    optional name as string
                    optional height
                end interface
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isInterfaceStatement(statements[0])).to.be.true;
            const iface = statements[0] as InterfaceStatement;
            iface.fields.forEach(f => expect(f.isOptional).to.be.true);
            const ifaceType = iface.getType({ flags: SymbolTypeFlag.typetime });
            // eslint-disable-next-line no-bitwise
            ifaceType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime).forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(SymbolTypeFlag.optional));
        });

        it('allows fields named optional', () => {
            let { statements, diagnostics } = parse(`
                interface IsJustOptional
                    optional
                    someThingElse
                end interface
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isInterfaceStatement(statements[0])).to.be.true;
            const iface = statements[0] as InterfaceStatement;
            iface.fields.forEach(f => expect(f.isOptional).to.be.false);
            const ifaceType = iface.getType({ flags: SymbolTypeFlag.typetime });
            const iFaceMembers = ifaceType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime);
            expect(iFaceMembers.length).to.eq(2);
            // eslint-disable-next-line no-bitwise
            iFaceMembers.forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(0));
        });

        it('allows fields named optional that are also optional', () => {
            let { statements, diagnostics } = parse(`
                interface IsJustOptional
                    optional optional
                end interface
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isInterfaceStatement(statements[0])).to.be.true;
            const iface = statements[0] as InterfaceStatement;
            iface.fields.forEach(f => expect(f.isOptional).to.be.true);
            const ifaceType = iface.getType({ flags: SymbolTypeFlag.typetime });
            const iFaceMembers = ifaceType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime);
            expect(iFaceMembers.length).to.eq(1);
            // eslint-disable-next-line no-bitwise
            iFaceMembers.forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(SymbolTypeFlag.optional));
        });

        it('allows optional methods', () => {
            let { statements, diagnostics } = parse(`
                interface HasOptional
                    optional function getValue() as boolean
                    optional sub noop()
                    optional function process()
                end interface
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isInterfaceStatement(statements[0])).to.be.true;
            const iface = statements[0] as InterfaceStatement;
            iface.methods.forEach(m => expect(m.isOptional).to.equal(true));
            const ifaceType = iface.getType({ flags: SymbolTypeFlag.typetime });
            // eslint-disable-next-line no-bitwise
            ifaceType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime).forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(SymbolTypeFlag.optional));
        });

        it('allows fields named `as` that are also optional', () => {
            let { statements, diagnostics } = parse(`
                interface IsJustOptional
                    optional as
                end interface
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isInterfaceStatement(statements[0])).to.be.true;
            const iface = statements[0] as InterfaceStatement;
            iface.fields.forEach(f => expect(f.isOptional).to.be.true);
            const ifaceType = iface.getType({ flags: SymbolTypeFlag.typetime });
            const iFaceMembers = ifaceType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime);
            expect(iFaceMembers.length).to.eq(1);
            // eslint-disable-next-line no-bitwise
            iFaceMembers.forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(SymbolTypeFlag.optional));
        });

        it('allows fields named `as` that are also typed', () => {
            let { statements, diagnostics } = parse(`
                interface IsJustOptional
                    optional as as string
                end interface
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isInterfaceStatement(statements[0])).to.be.true;
            const iface = statements[0] as InterfaceStatement;
            iface.fields.forEach(f => expect(f.isOptional).to.be.true);
            const ifaceType = iface.getType({ flags: SymbolTypeFlag.typetime });
            const iFaceMembers = ifaceType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime);
            expect(iFaceMembers.length).to.eq(1);
            // eslint-disable-next-line no-bitwise
            iFaceMembers.forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(SymbolTypeFlag.optional));
        });

        it('allows fields named `optional` that are also typed', () => {
            let { statements, diagnostics } = parse(`
                interface IsJustOptional
                    optional as string
                end interface
            `, ParseMode.BrighterScript);
            expectZeroDiagnostics(diagnostics);
            expect(statements.length).to.eq(1);
            expect(isInterfaceStatement(statements[0])).to.be.true;
            const iface = statements[0] as InterfaceStatement;
            iface.fields.forEach(f => expect(f.isOptional).to.be.false);
            const ifaceType = iface.getType({ flags: SymbolTypeFlag.typetime });
            const iFaceMembers = ifaceType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime);
            expect(iFaceMembers.length).to.eq(1);
            // eslint-disable-next-line no-bitwise
            iFaceMembers.forEach(sym => expect(sym.flags & SymbolTypeFlag.optional).to.eq(0));
        });
    });

    describe('leadingTrivia', () => {
        it('gets leading trivia from functions', () => {
            let { statements } = parse(`
                ' Nice function, bro
                function foo()
                    return 1
                end function
            `);
            const funcStatements = statements.filter(isFunctionStatement);
            const fooTrivia = funcStatements[0].getLeadingTrivia();
            expect(fooTrivia.length).to.be.greaterThan(0);
            expect(fooTrivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(1);
        });

        it('gets multiple lines of leading trivia', () => {
            let { statements } = parse(`
                ' Say hello to someone
                '
                ' @param {string} name the person you want to say hello to.
                sub sayHello(name as string = "world")
                end sub
            `);
            const funcStatements = statements.filter(isFunctionStatement);
            const helloTrivia = funcStatements[0].getLeadingTrivia();
            expect(helloTrivia.length).to.be.greaterThan(0);
            expect(helloTrivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(3);
        });

        it('gets leading trivia from classes', () => {
            let { statements } = parse(`
                ' hello
                ' classes
                class Hello
                end class
            `, ParseMode.BrighterScript);
            const classStatements = statements.filter(isClassStatement);
            const trivia = classStatements[0].getLeadingTrivia();
            expect(trivia.length).to.be.greaterThan(0);
            expect(trivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(2);
        });

        it('gets leading trivia from functions with annotations', () => {
            let { statements } = parse(`
                ' hello comment 1
                ' hello comment 2
                @annotation
                sub sayHello(name as string = "world")
                end sub
            `, ParseMode.BrighterScript);
            const funcStatements = statements.filter(isFunctionStatement);
            const helloTrivia = funcStatements[0].getLeadingTrivia();
            expect(helloTrivia.length).to.be.greaterThan(0);
            expect(helloTrivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(2);
        });


        it('gets leading trivia from class methods', () => {
            let { statements } = parse(`
                ' hello
                ' classes
                class Hello

                    ' Gets the value of PI
                    ' Not a dessert
                    function getPi() as float
                        return 3.14
                    end function

                    ' Gets a dessert
                    function getPie() as string
                        return "Apple Pie"
                    end function
                end class
            `, ParseMode.BrighterScript);
            const classStatement = statements.filter(isClassStatement)[0];
            const methodStatements = classStatement.methods;

            // function getPi()
            let trivia = methodStatements[0].getLeadingTrivia();
            expect(trivia.length).to.be.greaterThan(0);
            expect(trivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(2);

            // function getPie()
            trivia = methodStatements[1].getLeadingTrivia();
            expect(trivia.length).to.be.greaterThan(0);
            expect(trivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(1);
        });

        it('gets leading trivia from class fields', () => {
            let { statements } = parse(`
                ' hello
                ' classes
                class Thing
                    ' like the sky
                    ' or a blueberry, evn though that's purple
                    color = "blue"

                    ' My name
                    public name as string

                    ' Only I know how old I am
                    private age = 42
                end class
            `, ParseMode.BrighterScript);
            const classStatement = statements.filter(isClassStatement)[0];
            const fieldStatements = classStatement.fields;

            // color = "blue"
            let trivia = fieldStatements[0].getLeadingTrivia();
            expect(trivia.length).to.be.greaterThan(0);
            expect(trivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(2);

            // public name as string
            trivia = fieldStatements[1].getLeadingTrivia();
            expect(trivia.length).to.be.greaterThan(0);
            expect(trivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(1);

            // private age = 42
            trivia = fieldStatements[2].getLeadingTrivia();
            expect(trivia.length).to.be.greaterThan(0);
            expect(trivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(1);
        });

        it('gets leading trivia from interfaces', () => {
            let { statements } = parse(`
                ' Description of interface
                interface myIface
                    ' comment
                    someField as integer

                    'comment
                    function someFunc() as string
                end interface
            `, ParseMode.BrighterScript);
            const ifaceStatement = statements.filter(isInterfaceStatement)[0];
            const fieldStatements = ifaceStatement.fields;
            const methodStatements = ifaceStatement.methods;

            // interface myIface
            let trivia = ifaceStatement.getLeadingTrivia();
            expect(trivia.length).to.be.greaterThan(0);
            expect(trivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(1);

            // someField as integer
            trivia = fieldStatements[0].getLeadingTrivia();
            expect(trivia.length).to.be.greaterThan(0);
            expect(trivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(1);

            // function someFunc() as string
            trivia = methodStatements[0].getLeadingTrivia();
            expect(trivia.length).to.be.greaterThan(0);
            expect(trivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(1);
        });


        it('gets leading trivia from namespaces', () => {
            let { statements } = parse(`
                ' Description of interface
                namespace Nested.Name.Space

                end  namespace
            `, ParseMode.BrighterScript);
            const nameSpaceStatement = statements.filter(isNamespaceStatement)[0];

            // namespace Nested.Name.Space
            let trivia = nameSpaceStatement.getLeadingTrivia();
            expect(trivia.length).to.be.greaterThan(0);
            expect(trivia.filter(t => t.kind === TokenKind.Comment).length).to.eq(1);
        });
    });

    describe('unary/binary ordering', () => {
        it('creates the correct operator order for `not x = x` code', () => {
            let { diagnostics, statements } = parse(`
                function isStrNotEmpty(myStr as string) as boolean
                    return not myStr = ""
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(isFunctionStatement(statements[0])).to.be.true;
            const insideReturn = ((statements[0] as FunctionStatement).func.body.statements[0] as ReturnStatement).value;
            expect(isUnaryExpression(insideReturn)).to.be.true;
            expect(isBinaryExpression((insideReturn as UnaryExpression).right)).to.be.true;
        });

        it('creates the correct operator order for `not x + x` code', () => {
            let { diagnostics, statements } = parse(`
                function tryStuff() as integer
                    return not 1 + 3 ' same as "not (3)" ... eg. the "flipped bits" of 3 (0000 0011) -> 1111 1100, or -4
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(isFunctionStatement(statements[0])).to.be.true;
            const insideReturn = ((statements[0] as FunctionStatement).func.body.statements[0] as ReturnStatement).value;
            expect(isUnaryExpression(insideReturn)).to.be.true;
            expect(isBinaryExpression((insideReturn as UnaryExpression).right)).to.be.true;
        });

        it('creates the correct operator order for `x = not x` code', () => {
            let { diagnostics, statements } = parse(`
                function tryStuff() as boolean
                    return 4 = not -5 ' same as "4 = 4"
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(isFunctionStatement(statements[0])).to.be.true;
            const insideReturn = ((statements[0] as FunctionStatement).func.body.statements[0] as ReturnStatement).value;
            expect(isBinaryExpression(insideReturn)).to.be.true;
            expect(isLiteralExpression((insideReturn as BinaryExpression).left)).to.be.true;

            const right = (insideReturn as BinaryExpression).right as UnaryExpression;
            expect(isUnaryExpression(right)).to.be.true;
            expect(isUnaryExpression(right.right)).to.be.true; // not ( - ( 5))
        });

        it('allows multiple nots', () => {
            let { diagnostics, statements } = parse(`
                function tryStuff() as integer
                    return not not not 4
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(isFunctionStatement(statements[0])).to.be.true;
            const insideReturn = ((statements[0] as FunctionStatement).func.body.statements[0] as ReturnStatement).value;
            expect(isUnaryExpression(insideReturn)).to.be.true;
            expect(isUnaryExpression((insideReturn as UnaryExpression).right)).to.be.true;
            expect(isUnaryExpression(((insideReturn as UnaryExpression).right as UnaryExpression).right)).to.be.true;
        });

        it('allows multiple -', () => {
            let { diagnostics, statements } = parse(`
                function tryStuff() as integer
                    return - - - 4
                end function
            `);
            expectZeroDiagnostics(diagnostics);
            expect(isFunctionStatement(statements[0])).to.be.true;
            const insideReturn = ((statements[0] as FunctionStatement).func.body.statements[0] as ReturnStatement).value;
            expect(isUnaryExpression(insideReturn)).to.be.true;
            expect(isUnaryExpression((insideReturn as UnaryExpression).right)).to.be.true;
            expect(isUnaryExpression(((insideReturn as UnaryExpression).right as UnaryExpression).right)).to.be.true;
        });
    });
});

export function parse(text: string, mode?: ParseMode) {
    let { tokens } = Lexer.scan(text);
    return Parser.parse(tokens, {
        mode: mode!
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
