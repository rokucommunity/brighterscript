import { expect } from '../../../chai-config.spec';
import { Range } from 'vscode-languageserver';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Program } from '../../../Program';
import { expectDiagnostics, expectZeroDiagnostics, getTestGetTypedef, getTestTranspile, rootDir } from '../../../testHelpers.spec';
import { ParseMode, Parser } from '../../Parser';
import { isAALiteralExpression, isArrayLiteralExpression, isBinaryExpression, isCallExpression, isFunctionExpression, isGroupingExpression, isLiteralExpression, isPrintStatement, isReturnStatement, isTernaryExpression, isTypecastExpression, isVoidType } from '../../../astUtils/reflection';
import { WalkMode } from '../../../astUtils/visitors';
import type { AssignmentStatement, FunctionStatement, PrintStatement, ReturnStatement } from '../../Statement';
import type { AALiteralExpression, AAMemberExpression, ArrayLiteralExpression, BinaryExpression, CallExpression, FunctionExpression, GroupingExpression } from '../../Expression';
import type { AstNode } from '../../AstNode';
import { SymbolTypeFlag } from '../../../SymbolTypeFlag';
import type { BrsFile } from '../../../files/BrsFile';
import { TokenKind } from '../../../lexer/TokenKind';
import { util } from '../../../util';

describe('arrow functions', () => {
    /**
     * Parse `code` as the body of a function and return the parsed statements
     */
    function parseBody(code: string, mode = ParseMode.BrighterScript) {
        const parser = Parser.parse(`function main()\n    ${code}\nend function`, { mode: mode });
        expectZeroDiagnostics(parser.diagnostics);
        return (parser.ast.statements[0] as FunctionStatement).func.body.statements;
    }

    /**
     * Parse `code` as the only statement of a function body and return the value of its assignment
     */
    function parseValue(code: string) {
        const assignment = parseBody(code)[0] as AssignmentStatement;
        return assignment.value;
    }

    function expectArrow(value: AstNode) {
        expect(isFunctionExpression(value), 'expected an arrow function').to.be.true;
        const func = value as FunctionExpression;
        expect(func.isArrowFunction).to.be.true;
        return func;
    }

    function parseArrow(code: string) {
        return expectArrow(parseValue(code));
    }

    describe('parser', () => {
        describe('forms', () => {
            it('parses an arrow function with no params', () => {
                const func = parseArrow('getZero = () => 0');
                expect(func.parameters).to.be.empty;
                expect(isLiteralExpression(func.arrowBody)).to.be.true;
                //the body is stored as a `return` statement, and there are no function keywords
                expect(func.body.statements).to.have.lengthOf(1);
                expect(isReturnStatement(func.body.statements[0])).to.be.true;
                expect(func.tokens.functionType).to.be.undefined;
                expect(func.tokens.endFunctionType).to.be.undefined;
                expect(func.tokens.arrow.kind).to.eql(TokenKind.Arrow);
            });

            it('parses a single param', () => {
                const func = parseArrow('twice = (x) => x * 2');
                expect(func.parameters.map(param => param.tokens.name.text)).to.eql(['x']);
                expect(isBinaryExpression(func.arrowBody)).to.be.true;
            });

            it('parses multiple untyped params', () => {
                const func = parseArrow('add = (a, b, c) => a + b + c');
                expect(func.parameters.map(param => param.tokens.name.text)).to.eql(['a', 'b', 'c']);
            });

            it('parses typed params and a return type', () => {
                const func = parseArrow('add = (a as integer, b as integer) as integer => a + b');
                expect(func.parameters.map(param => param.tokens.name.text)).to.eql(['a', 'b']);
                expect(func.parameters[0].typeExpression.getType({ flags: SymbolTypeFlag.typetime }).toString()).to.eql('integer');
                expect(func.tokens.as).to.exist;
                expect(func.returnTypeExpression.getType({ flags: SymbolTypeFlag.typetime }).toString()).to.eql('integer');
            });

            it('parses a mix of typed and untyped params', () => {
                const func = parseArrow('f = (a, b as string, c) => a');
                expect(func.parameters[0].typeExpression).to.be.undefined;
                expect(func.parameters[1].typeExpression).to.exist;
                expect(func.parameters[2].typeExpression).to.be.undefined;
            });

            it('parses typed array params and union return types', () => {
                const func = parseArrow('first = (items as integer[]) as integer or string => items[0]');
                expect(func.parameters[0].typeExpression.getType({ flags: SymbolTypeFlag.typetime }).toString()).to.eql('Array<integer>');
                expect(func.returnTypeExpression.getType({ flags: SymbolTypeFlag.typetime }).toString()).to.eql('integer or string');
            });

            it('parses function-typed params', () => {
                const func = parseArrow('apply = (callback as function(x as integer) as integer) => callback(1)');
                expect(func.parameters[0].typeExpression.getType({ flags: SymbolTypeFlag.typetime }).toString()).to.eql('function (x as integer) as integer');
            });

            it('parses a void return type', () => {
                const func = parseArrow('logIt = (message as string) as void => doLog(message)');
                expect(isVoidType(func.returnTypeExpression.getType({ flags: SymbolTypeFlag.typetime }))).to.be.true;
            });

            it('parses default param values', () => {
                const func = parseArrow('greet = (name = "world") => "hello " + name');
                expect(func.parameters[0].defaultValue).to.exist;
                expect(func.parameters[0].tokens.equals).to.exist;
            });

            it('parses a default value that refers to an earlier param', () => {
                const func = parseArrow('f = (a, b = a) => a + b');
                expect(func.parameters[1].defaultValue).to.exist;
            });

            it('parses an arrow function as a default param value', () => {
                const func = parseArrow('f = (callback = (x) => x) => callback(1)');
                expectArrow(func.parameters[0].defaultValue);
            });

            it('parses without any whitespace', () => {
                const func = parseArrow('f=(x)=>x*2');
                expect(func.parameters.map(param => param.tokens.name.text)).to.eql(['x']);
                expect(isBinaryExpression(func.arrowBody)).to.be.true;
            });

            it('parses with extra whitespace', () => {
                const func = parseArrow('f = (  x ,  y  )   =>   x');
                expect(func.parameters.map(param => param.tokens.name.text)).to.eql(['x', 'y']);
            });

            it('stops the body at a colon statement separator', () => {
                const statements = parseBody('f = (x) => x : print f(1)');
                expect(statements).to.have.lengthOf(2);
                expectArrow((statements[0] as AssignmentStatement).value);
                expect(isPrintStatement(statements[1])).to.be.true;
            });
        });

        describe('body', () => {
            it('parses a parenthesized AA literal body', () => {
                const func = parseArrow('makePoint = (x, y) => ({ x: x, y: y })');
                expect(isGroupingExpression(func.arrowBody)).to.be.true;
                expect(isAALiteralExpression((func.arrowBody as GroupingExpression).expression)).to.be.true;
            });

            it('parses an array literal body', () => {
                const func = parseArrow('pair = (x, y) => [x, y]');
                expect(isArrayLiteralExpression(func.arrowBody)).to.be.true;
            });

            it('parses a body that starts with a grouping expression', () => {
                const func = parseArrow('f = (x) => (x + 1) * 2');
                expect(isBinaryExpression(func.arrowBody)).to.be.true;
                expect(isGroupingExpression((func.arrowBody as BinaryExpression).left)).to.be.true;
            });

            it('extends the body as far right as possible', () => {
                const func = parseArrow('pick = (a) => a ? 1 : 2');
                expect(isTernaryExpression(func.arrowBody)).to.be.true;
            });

            it('parses a call body', () => {
                const func = parseArrow('f = (x) => doThing(x, 1)');
                expect(isCallExpression(func.arrowBody)).to.be.true;
            });

            it('parses a typecast body', () => {
                const func = parseArrow('f = (x) => x as string');
                expect(isTypecastExpression(func.arrowBody)).to.be.true;
            });

            it('parses nested arrow functions', () => {
                const outer = parseArrow('f = (a) => (b) => b');
                const inner = expectArrow(outer.arrowBody);
                expect(inner.parameters.map(param => param.tokens.name.text)).to.eql(['b']);
            });

            it('parses a body that immediately invokes another arrow function', () => {
                const func = parseArrow('f = (x) => ((y) => y * 2)(x)');
                expect(isCallExpression(func.arrowBody)).to.be.true;
                const callee = (func.arrowBody as CallExpression).callee;
                expect(isGroupingExpression(callee)).to.be.true;
                expectArrow((callee as GroupingExpression).expression);
            });
        });

        describe('contexts', () => {
            it('parses an arrow function as a call argument', () => {
                const value = parseValue('result = filter(items, (i) => i.rating > 3.5)');
                expect(isCallExpression(value)).to.be.true;
                expectArrow((value as CallExpression).args[1]);
            });

            it('parses several arrow functions in one call', () => {
                const value = parseValue('result = combine((a) => a, (b) => b, (c) => c)') as CallExpression;
                expect(value.args).to.have.lengthOf(3);
                for (const arg of value.args) {
                    expectArrow(arg);
                }
            });

            it('parses an immediately-invoked arrow function', () => {
                const value = parseValue('y = ((a, b) => a + b)(1, 2)');
                expect(isCallExpression(value)).to.be.true;
                const callee = (value as CallExpression).callee;
                expect(isGroupingExpression(callee)).to.be.true;
                expectArrow((callee as GroupingExpression).expression);
                expect((value as CallExpression).args).to.have.lengthOf(2);
            });

            it('parses arrow functions inside an array literal', () => {
                const value = parseValue('arr = [(x) => x, (y) => y * 2]') as ArrayLiteralExpression;
                expect(value.elements).to.have.lengthOf(2);
                expectArrow(value.elements[0]);
                expectArrow(value.elements[1]);
            });

            it('parses an arrow function as an AA literal value', () => {
                const value = parseValue('aa = { callback: (x) => x }') as AALiteralExpression;
                expectArrow((value.elements[0] as AAMemberExpression).value);
            });

            it('parses an arrow function in a return statement', () => {
                const statement = parseBody('return (z) => z')[0] as ReturnStatement;
                expect(isReturnStatement(statement)).to.be.true;
                expectArrow(statement.value);
            });

            it('parses an immediately-invoked arrow function in a print statement', () => {
                const statement = parseBody('print ((x) => x * 2)(4)')[0] as PrintStatement;
                expect(isPrintStatement(statement)).to.be.true;
                expect(isCallExpression(statement.expressions[0])).to.be.true;
            });

            it('parses an arrow function as a class field initializer', () => {
                const parser = Parser.parse(`
                    class Person
                        callback = (x as integer) => x
                    end class
                `, { mode: ParseMode.BrighterScript });
                expectZeroDiagnostics(parser.diagnostics);
                const field = (parser.ast.statements[0] as any).fields[0];
                expectArrow(field.initialValue);
            });

            it('parses an arrow function inside a namespace', () => {
                const parser = Parser.parse(`
                    namespace alpha
                        sub main()
                            f = (x) => beta(x)
                        end sub
                    end namespace
                `, { mode: ParseMode.BrighterScript });
                expectZeroDiagnostics(parser.diagnostics);
                const func = parser.ast.findChild<FunctionExpression>((node) => isFunctionExpression(node) && node.isArrowFunction, { walkMode: WalkMode.visitAllRecursive });
                expect(func).to.exist;
            });
        });

        describe('does not disturb existing syntax', () => {
            it('still parses grouping expressions', () => {
                const value = parseValue('x = (a + b) * 2');
                expect(isBinaryExpression(value)).to.be.true;
                expect(isGroupingExpression((value as BinaryExpression).left)).to.be.true;
            });

            it('still parses a parenthesized variable', () => {
                const value = parseValue('x = (a)');
                expect(isGroupingExpression(value)).to.be.true;
            });

            it('still parses a parenthesized typecast', () => {
                const value = parseValue('x = (a as integer)');
                expect(isGroupingExpression(value)).to.be.true;
                expect(isTypecastExpression((value as GroupingExpression).expression)).to.be.true;
            });

            it('still parses a parenthesized typecast followed by more expression', () => {
                const value = parseValue('x = (a as integer) + 1');
                expect(isBinaryExpression(value)).to.be.true;
                expect(isGroupingExpression((value as BinaryExpression).left)).to.be.true;
            });

            it('still parses a parenthesized comparison', () => {
                const value = parseValue('x = (a = 1)');
                expect(isGroupingExpression(value)).to.be.true;
                expect(isBinaryExpression((value as GroupingExpression).expression)).to.be.true;
            });

            it('still parses a parenthesized call', () => {
                const value = parseValue('x = (a(1))');
                expect(isGroupingExpression(value)).to.be.true;
                expect(isCallExpression((value as GroupingExpression).expression)).to.be.true;
            });

            it('still parses a parenthesized condition in an if statement', () => {
                const statements = parseBody('if (a) then print 1');
                expect(statements).to.have.lengthOf(1);
            });

            it('still parses a greater-than-or-equal comparison', () => {
                const value = parseValue('x = a >= b') as BinaryExpression;
                expect(isBinaryExpression(value)).to.be.true;
                expect(value.tokens.operator.kind).to.eql(TokenKind.GreaterEqual);
            });

            it('still parses regular anonymous functions', () => {
                const statements = parseBody('f = function(x)\n        return x\n    end function');
                const func = (statements[0] as AssignmentStatement).value as FunctionExpression;
                expect(isFunctionExpression(func)).to.be.true;
                expect(func.isArrowFunction).to.be.false;
                expect(func.arrowBody).to.be.undefined;
            });
        });

        describe('locations', () => {
            it('spans from the open paren to the end of the body', () => {
                const func = parseArrow('twice = (x) => x * 2');
                //    twice = (x) => x * 2
                expect(func.location.range).to.eql(Range.create(1, 12, 1, 24));
            });

            it('spans a typed arrow function', () => {
                const func = parseArrow('add = (a as integer, b as integer) as integer => a + b');
                //    add = (a as integer, b as integer) as integer => a + b
                expect(func.location.range).to.eql(Range.create(1, 10, 1, 58));
            });

            it('locates the arrow token', () => {
                const func = parseArrow('twice = (x) => x * 2');
                expect(func.tokens.arrow.text).to.eql('=>');
                expect(func.tokens.arrow.location.range).to.eql(Range.create(1, 16, 1, 18));
            });

            it('locates the body expression', () => {
                const func = parseArrow('twice = (x) => x * 2');
                expect(func.arrowBody.location.range).to.eql(Range.create(1, 19, 1, 24));
                //the synthesized return statement has the same range as the body (there is no `return` token)
                expect(func.body.statements[0].location.range).to.eql(Range.create(1, 19, 1, 24));
            });
        });

        describe('ast', () => {
            it('links parents', () => {
                const func = parseArrow('twice = (x) => x * 2');
                expect(func.body.parent).to.equal(func);
                expect(func.body.statements[0].parent).to.equal(func.body);
                expect(func.arrowBody.parent).to.equal(func.body.statements[0]);
                expect(func.parameters[0].parent).to.equal(func);
            });

            it('is found by recursive walks, including its synthesized return statement', () => {
                const parser = Parser.parse(`sub main()\n    f = (x) => x\nend sub`, { mode: ParseMode.BrighterScript });
                const arrows = parser.ast.findChildren<FunctionExpression>((node) => isFunctionExpression(node) && node.isArrowFunction, { walkMode: WalkMode.visitAllRecursive });
                expect(arrows).to.have.lengthOf(1);
                const returns = parser.ast.findChildren<ReturnStatement>(isReturnStatement, { walkMode: WalkMode.visitAllRecursive });
                expect(returns).to.have.lengthOf(1);
            });

            it('clones', () => {
                const func = parseArrow('twice = (x) => x * 2');
                const clone = func.clone();
                expect(clone.isArrowFunction).to.be.true;
                expect(clone.arrowBody).to.exist;
                expect(clone.arrowBody).not.to.equal(func.arrowBody);
                expect(clone.tokens.arrow).not.to.equal(func.tokens.arrow);
                expect(clone.tokens.arrow.text).to.eql('=>');
                expect(clone.body.parent).to.equal(clone);
                expect(clone.location.range).to.eql(func.location.range);
            });
        });

        describe('diagnostics', () => {
            it('flags a missing body before a newline', () => {
                const parser = Parser.parse(`sub main()\n    x = (a) =>\nend sub`, { mode: ParseMode.BrighterScript });
                expectDiagnostics(parser.diagnostics, [
                    DiagnosticMessages.expectedExpressionAfterArrow()
                ]);
            });

            it('flags a missing body before a colon', () => {
                const parser = Parser.parse(`sub main()\n    x = (a) => : print 1\nend sub`, { mode: ParseMode.BrighterScript });
                expectDiagnostics(parser.diagnostics, [
                    DiagnosticMessages.expectedExpressionAfterArrow()
                ]);
            });

            it('flags a missing body at the end of the file', () => {
                const parser = Parser.parse(`x = (a) =>`, { mode: ParseMode.BrighterScript });
                expectDiagnostics(parser.diagnostics, [
                    DiagnosticMessages.expectedExpressionAfterArrow()
                ]);
            });

            it('flags required params after optional ones', () => {
                const parser = Parser.parse(`sub main()\n    f = (a = 1, b) => a + b\nend sub`, { mode: ParseMode.BrighterScript });
                expectDiagnostics(parser.diagnostics, [
                    DiagnosticMessages.requiredParameterMayNotFollowOptionalParameter('b')
                ]);
            });

            it('flags a missing type after "as" but still parses the arrow function', () => {
                const parser = Parser.parse(`sub main()\n    f = (a as) => a\nend sub`, { mode: ParseMode.BrighterScript });
                expectDiagnostics(parser.diagnostics, [
                    DiagnosticMessages.expectedIdentifier('as')
                ]);
                const func = parser.ast.findChild<FunctionExpression>((node) => isFunctionExpression(node) && node.isArrowFunction, { walkMode: WalkMode.visitAllRecursive });
                expect(func).to.exist;
            });

            it('reports an unmatched paren the same as a grouping expression would', () => {
                const parser = Parser.parse(`sub main()\n    f = (a, b => a\nend sub`, { mode: ParseMode.BrighterScript });
                expectDiagnostics(parser.diagnostics, [
                    DiagnosticMessages.unmatchedLeftToken('(', 'expression')
                ]);
            });

            it('flags a standalone arrow function statement', () => {
                const parser = Parser.parse(`sub main()\n    (x) => x\nend sub`, { mode: ParseMode.BrighterScript });
                expectDiagnostics(parser.diagnostics, [
                    DiagnosticMessages.expectedStatement()
                ]);
            });

            it('is not allowed in brightscript mode', () => {
                const parser = Parser.parse(`sub main()\n    f = (a) => a\nend sub`, { mode: ParseMode.BrightScript });
                expectDiagnostics(parser.diagnostics, [
                    DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('arrow functions')
                ]);
            });

            it('still parses groupings in brightscript mode without diagnostics', () => {
                const parser = Parser.parse(`sub main()\n    x = (a + b) * 2\n    y = (a)\nend sub`, { mode: ParseMode.BrightScript });
                expectZeroDiagnostics(parser.diagnostics);
            });
        });
    });

    describe('program', () => {
        let program: Program;
        const testTranspile = getTestTranspile(() => [program, rootDir]);
        const testGetTypedef = getTestGetTypedef(() => [program, rootDir]);

        beforeEach(() => {
            program = new Program({ rootDir: rootDir, sourceMap: true });
        });
        afterEach(() => {
            program.dispose();
        });

        /**
         * Validate `source/main.bs` containing `code` (expecting no diagnostics) and return the first arrow function in it
         */
        function getArrowFunction(code: string) {
            const file = program.setFile<BrsFile>('source/main.bs', code);
            program.validate();
            expectZeroDiagnostics(program);
            return file.ast.findChild<FunctionExpression>((node) => isFunctionExpression(node) && node.isArrowFunction, { walkMode: WalkMode.visitAllRecursive });
        }

        /**
         * Validate `source/main.bs` containing `code` and return the codes of the resulting diagnostics
         */
        function getDiagnosticCodes(code: string) {
            program.setFile('source/main.bs', code);
            program.validate();
            return program.getDiagnostics().map(diagnostic => diagnostic.code);
        }

        describe('transpile', () => {
            it('transpiles to an anonymous function that returns the expression', async () => {
                await testTranspile(`
                    sub main()
                        twice = (x) => x * 2
                    end sub
                `, `
                    sub main()
                        twice = function(x)
                            return x * 2
                        end function
                    end sub
                `);
            });

            it('transpiles an arrow function with no params', async () => {
                await testTranspile(`
                    sub main()
                        getZero = () => 0
                    end sub
                `, `
                    sub main()
                        getZero = function()
                            return 0
                        end function
                    end sub
                `);
            });

            it('keeps param and return types', async () => {
                await testTranspile(`
                    sub main()
                        add = (a as integer, b as integer) as integer => a + b
                    end sub
                `, `
                    sub main()
                        add = function(a as integer, b as integer) as integer
                            return a + b
                        end function
                    end sub
                `);
            });

            it('removes param and return types when removeParameterTypes is set', async () => {
                program.options.removeParameterTypes = true;
                await testTranspile(`
                    sub main()
                        add = (a as integer, b as integer) as integer => a + b
                    end sub
                `, `
                    sub main()
                        add = function(a, b)
                            return a + b
                        end function
                    end sub
                `);
            });

            it('converts brighterscript-only param types', async () => {
                await testTranspile(`
                    class Person
                        name as string
                    end class
                    sub main()
                        getName = (p as Person, others as Person[]) => p.name
                    end sub
                `, `
                    sub __Person_method_new()
                        m.name = invalid
                    end sub
                    function __Person_builder()
                        instance = {}
                        instance.new = __Person_method_new
                        return instance
                    end function
                    function Person()
                        instance = __Person_builder()
                        instance.new()
                        return instance
                    end function

                    sub main()
                        getName = function(p as dynamic, others as dynamic)
                            return p.name
                        end function
                    end sub
                `);
            });

            it('keeps default param values', async () => {
                await testTranspile(`
                    sub main()
                        greet = (name = "world") => "hello " + name
                    end sub
                `, `
                    sub main()
                        greet = function(name = "world")
                            return "hello " + name
                        end function
                    end sub
                `);
            });

            it('keeps a default value that refers to an earlier param', async () => {
                await testTranspile(`
                    sub main()
                        f = (a, b = a) => a + b
                    end sub
                `, `
                    sub main()
                        f = function(a, b = a)
                            return a + b
                        end function
                    end sub
                `);
            });

            it('transpiles as a call argument', async () => {
                await testTranspile(`
                    sub main()
                        result = apply((i) => i > 1)
                    end sub
                    function apply(predicate)
                        return predicate(2)
                    end function
                `, `
                    sub main()
                        result = apply(function(i)
                            return i > 1
                        end function)
                    end sub

                    function apply(predicate)
                        return predicate(2)
                    end function
                `);
            });

            it('transpiles several arrow functions in one call', async () => {
                await testTranspile(`
                    sub main()
                        result = combine((a) => a, (b) => b)
                    end sub
                    function combine(first, second)
                        return first(1) + second(2)
                    end function
                `, `
                    sub main()
                        result = combine(function(a)
                            return a
                        end function, function(b)
                            return b
                        end function)
                    end sub

                    function combine(first, second)
                        return first(1) + second(2)
                    end function
                `);
            });

            it('transpiles nested arrow functions', async () => {
                await testTranspile(`
                    sub main()
                        f = (a) => (b) => b
                    end sub
                `, `
                    sub main()
                        f = function(a)
                            return function(b)
                                return b
                            end function
                        end function
                    end sub
                `);
            });

            it('transpiles immediately-invoked arrow functions', async () => {
                await testTranspile(`
                    sub main()
                        print ((x) => x * 2)(4)
                        y = ((a, b) => a + b)(1, 2)
                    end sub
                `, `
                    sub main()
                        print (function(x)
                            return x * 2
                        end function)(4)
                        y = (function(a, b)
                            return a + b
                        end function)(1, 2)
                    end sub
                `);
            });

            it('transpiles a parenthesized AA literal body', async () => {
                await testTranspile(`
                    sub main()
                        makePoint = (x, y) => ({ x: x, y: y })
                    end sub
                `, `
                    sub main()
                        makePoint = function(x, y)
                            return ({
                                x: x
                                y: y
                            })
                        end function
                    end sub
                `);
            });

            it('transpiles a template string body', async () => {
                await testTranspile(`
                    sub main()
                        greet = (name) => \`hi \${name}\`
                    end sub
                `, `
                    sub main()
                        greet = function(name)
                            return ("hi " + bslib_toString(name))
                        end function
                    end sub
                `);
            });

            it('transpiles a null-coalescing body', async () => {
                await testTranspile(`
                    sub main()
                        orOne = (x) => x ?? 1
                    end sub
                `, `
                    sub main()
                        orOne = function(x)
                            return bslib_coalesce(x, 1)
                        end function
                    end sub
                `);
            });

            it('transpiles a ternary body', async () => {
                await testTranspile(`
                    sub main()
                        size = (x) => x > 1 ? "big" : "small"
                    end sub
                `, `
                    sub main()
                        size = function(x)
                            return bslib_ternary(x > 1, "big", "small")
                        end function
                    end sub
                `);
            });

            it('transpiles arrow functions as ternary branches', async () => {
                await testTranspile(`
                    sub main(useA)
                        callback = useA ? (a) => a : (b) => b
                    end sub
                `, `
                    sub main(useA)
                        if useA then
                            callback = function(a)
                                return a
                            end function
                        else
                            callback = function(b)
                                return b
                            end function
                        end if
                    end sub
                `);
            });

            it('transpiles an arrow function as a null-coalescing fallback', async () => {
                await testTranspile(`
                    sub main(handler)
                        callback = handler ?? ((x) => x)
                    end sub
                `, `
                    sub main(handler)
                        callback = bslib_coalesce(handler, (function(x)
                            return x
                        end function))
                    end sub
                `);
            });

            it('transpiles arrow functions inside array literals, AA literals and return statements', async () => {
                await testTranspile(`
                    function main()
                        arr = [(x) => x, (y) => y * 2]
                        aa = { callback: (x) => x }
                        return (z) => z
                    end function
                `, `
                    function main()
                        arr = [
                            function(x)
                                return x
                            end function
                            function(y)
                                return y * 2
                            end function
                        ]
                        aa = {
                            callback: function(x)
                                return x
                            end function
                        }
                        return function(z)
                            return z
                        end function
                    end function
                `);
            });

            it('transpiles an arrow function as a callfunc argument', async () => {
                await testTranspile(`
                    sub main(node as roSGNode)
                        node@.doIt((x) => x)
                    end sub
                `, `
                    sub main(node as dynamic)
                        node.callfunc("doIt", function(x)
                            return x
                        end function)
                    end sub
                `);
            });

            it('resolves namespace-relative references inside the body', async () => {
                await testTranspile(`
                    namespace alpha
                        function beta(x)
                            return x
                        end function
                        sub main()
                            f = (x) => beta(x)
                            g = (x) => alpha.beta(x)
                        end sub
                    end namespace
                `, `
                    function alpha_beta(x)
                        return x
                    end function

                    sub alpha_main()
                        f = function(x)
                            return alpha_beta(x)
                        end function
                        g = function(x)
                            return alpha_beta(x)
                        end function
                    end sub
                `);
            });

            it('inlines enums and consts used inside the body', async () => {
                program.setFile('source/main.bs', `
                    enum Direction
                        up = 1
                    end enum
                    const MAX = 10
                    sub main()
                        f = (x) => x + Direction.up + MAX
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const result = await program.getTranspiledFileContents('source/main.bs');
                expect(result.code).to.include('return x + 1 + 10');
            });

            it('transpiles class constructors called inside the body', async () => {
                program.setFile('source/main.bs', `
                    class Person
                    end class
                    sub main()
                        make = () => new Person()
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const result = await program.getTranspiledFileContents('source/main.bs');
                expect(result.code).to.include('make = function()\n        return Person()\n    end function');
            });

            it('transpiles an arrow function as a class field initializer', async () => {
                program.setFile('source/main.bs', `
                    class Person
                        callback = (x as integer) => x
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const result = await program.getTranspiledFileContents('source/main.bs');
                expect(result.code).to.include('m.callback = function(x as integer)\n        return x\n    end function');
            });

            it('types an arrow function class field as Function in typedefs', async () => {
                await testGetTypedef(`
                    class Person
                        callback = (x as integer) => x
                    end class
                `, `
                    class Person
                        sub new()
                        end sub
                        public callback as Function
                    end class
                `);
            });

            it('transpiles arrow functions inside conditional compile blocks', async () => {
                await testTranspile(`
                    sub main()
                        #if true
                            f = (x) => x
                        #else
                            f = (x) => x * 2
                        #end if
                    end sub
                `, `
                    sub main()
                        #if true
                            f = function(x)
                                return x
                            end function
                        #else
                            f = function(x)
                                return x * 2
                            end function
                        #end if
                    end sub
                `, 'trim', 'source/main.bs', false);
            });

            it('keeps a trailing comment', async () => {
                await testTranspile(`
                    sub main()
                        twice = (x) => x * 2 ' double it
                    end sub
                `, `
                    sub main()
                        twice = function(x)
                            return x * 2
                        end function ' double it
                    end sub
                `);
            });

            it('becomes a sub when the body calls a built-in that returns nothing', async () => {
                await testTranspile(`
                    sub main()
                        addItem = (list as integer[], item as integer) => list.push(item)
                    end sub
                `, `
                    sub main()
                        addItem = sub(list as dynamic, item as integer)
                            list.push(item)
                        end sub
                    end sub
                `);
            });

            it('becomes a sub when the body calls a sub', async () => {
                await testTranspile(`
                    sub main()
                        logIt = (message as string) => doLog(message)
                    end sub
                    sub doLog(message as string)
                    end sub
                `, `
                    sub main()
                        logIt = sub(message as string)
                            doLog(message)
                        end sub
                    end sub

                    sub doLog(message as string)
                    end sub
                `);
            });

            it('becomes a sub when the body calls a function declared as void', async () => {
                await testTranspile(`
                    sub main()
                        logIt = (message as string) => doLog(message)
                    end sub
                    function doLog(message as string) as void
                    end function
                `, `
                    sub main()
                        logIt = sub(message as string)
                            doLog(message)
                        end sub
                    end sub

                    function doLog(message as string) as void
                    end function
                `);
            });

            it('becomes a sub when the body calls a namespaced sub', async () => {
                await testTranspile(`
                    namespace alpha
                        sub doLog(message as string)
                        end sub
                    end namespace
                    sub main()
                        logIt = (message as string) => alpha.doLog(message)
                    end sub
                `, `
                    sub alpha_doLog(message as string)
                    end sub

                    sub main()
                        logIt = sub(message as string)
                            alpha_doLog(message)
                        end sub
                    end sub
                `);
            });

            it('becomes a sub when the return type is void', async () => {
                await testTranspile(`
                    sub main()
                        logIt = (message as string) as void => doLog(message)
                    end sub
                    sub doLog(message as string)
                    end sub
                `, `
                    sub main()
                        logIt = sub(message as string) as void
                            doLog(message)
                        end sub
                    end sub

                    sub doLog(message as string)
                    end sub
                `);
            });

            it('stays a function when the body calls a function that returns a value', async () => {
                await testTranspile(`
                    sub main()
                        upper = (text as string) => ucase(text)
                        twice = (x as integer) => doubleIt(x)
                    end sub
                    function doubleIt(x as integer) as integer
                        return x * 2
                    end function
                `, `
                    sub main()
                        upper = function(text as string)
                            return ucase(text)
                        end function
                        twice = function(x as integer)
                            return doubleIt(x)
                        end function
                    end sub

                    function doubleIt(x as integer) as integer
                        return x * 2
                    end function
                `);
            });

            it('stays a function when the body calls something of unknown type', async () => {
                await testTranspile(`
                    sub main()
                        run = (callback, x) => callback(x)
                    end sub
                `, `
                    sub main()
                        run = function(callback, x)
                            return callback(x)
                        end function
                    end sub
                `, 'trim', 'source/main.bs', false);
            });
        });

        describe('types', () => {
            it('infers the return type from the body', () => {
                const func = getArrowFunction(`
                    sub main()
                        twice = (x as integer) => x * 2
                        print twice(2)
                    end sub
                `);
                expect(func.getType({ flags: SymbolTypeFlag.runtime }).toString()).to.eql('function (x as integer) as integer');
            });

            it('infers string, boolean and class return types', () => {
                program.setFile('source/main.bs', `
                    class Person
                    end class
                    sub main()
                        concat = (a as string, b as string) => a + b
                        isBig = (a as integer) => a > 1
                        make = () => new Person()
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const file = program.getFile<BrsFile>('source/main.bs');
                const arrows = file.ast.findChildren<FunctionExpression>((node) => isFunctionExpression(node) && node.isArrowFunction, { walkMode: WalkMode.visitAllRecursive });
                const returnTypes = arrows.map(arrow => arrow.getType({ flags: SymbolTypeFlag.runtime }).returnType.toString());
                expect(returnTypes).to.eql(['string', 'boolean', 'Person']);
            });

            it('uses the declared return type when there is one', () => {
                const func = getArrowFunction(`
                    sub main()
                        f = (x as integer) as dynamic => x
                    end sub
                `);
                expect(func.getType({ flags: SymbolTypeFlag.runtime }).toString()).to.eql('function (x as integer) as dynamic');
            });

            it('treats untyped params as dynamic', () => {
                const func = getArrowFunction(`
                    sub main()
                        f = (x) => x
                    end sub
                `);
                expect(func.getType({ flags: SymbolTypeFlag.runtime }).toString()).to.eql('function (x as dynamic) as dynamic');
            });

            it('treats a body that calls a sub as void', () => {
                const func = getArrowFunction(`
                    sub main()
                        logIt = (message as string) => doLog(message)
                    end sub
                    sub doLog(message as string)
                    end sub
                `);
                const type = func.getType({ flags: SymbolTypeFlag.runtime });
                expect(type.isSub).to.be.true;
                expect(isVoidType(type.returnType)).to.be.true;
            });

            it('types a nested arrow function as a function returning a function', () => {
                const func = getArrowFunction(`
                    sub main()
                        f = (a as integer) => (b as integer) => b
                    end sub
                `);
                //the inner arrow function is a plain function value, so this is a function that returns a function
                expect(func.getType({ flags: SymbolTypeFlag.runtime }).toString()).to.eql('function (a as integer) as function (b as integer) as integer');
            });
        });

        describe('validation', () => {
            describe('captured variables', () => {
                it('becomes a closure when it uses a local of the enclosing function (see Closure.spec.ts)', () => {
                    const func = getArrowFunction(`
                        sub main()
                            factor = 2
                            scale = (x as integer) => x * factor
                            print scale(1)
                        end sub
                    `);
                    expect(func.isClosure).to.be.true;
                    expect(util.getClosureCapturedVariables(func)).to.eql(['factor']);
                });

                it('is not a closure when it only uses its own params and file-level names', () => {
                    const func = getArrowFunction(`
                        sub main()
                            twice = (x as integer) => helper(x) * 2
                            print twice(1)
                        end sub
                        function helper(x as integer) as integer
                            return x
                        end function
                    `);
                    expect(func.isClosure).to.be.false;
                    expect(util.getClosureCapturedVariables(func)).to.eql([]);
                });

                it('still reports unknown names as cannot-find-name', () => {
                    program.setFile('source/main.bs', `
                        sub main()
                            f = (x) => x + unknownThing
                        end sub
                    `);
                    program.validate();
                    expectDiagnostics(program, [
                        DiagnosticMessages.cannotFindName('unknownThing')
                    ]);
                });

                it('does not treat a param that shadows an enclosing local as a capture', () => {
                    const func = getArrowFunction(`
                        sub main()
                            factor = 2
                            f = (factor) => factor * 2
                        end sub
                    `);
                    expect(func.isClosure).to.be.false;
                });

                it('allows a default value that refers to an earlier param', () => {
                    program.setFile('source/main.bs', `
                        sub main()
                            f = (a, b = a) => a + b
                            print f(1)
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });

                it('allows a regular anonymous function inside an arrow function to use the arrow params', () => {
                    program.setFile('source/main.bs', `
                        sub main()
                            f = (x) => function(y)
                                return y
                            end function
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });
            });

            describe('m', () => {
                it('flags m', () => {
                    program.setFile('source/main.bs', `
                        sub main()
                            render = (data) => m.view.setData(data)
                            getM = () => m
                        end sub
                    `);
                    program.validate();
                    expectDiagnostics(program, [{
                        ...DiagnosticMessages.arrowFunctionCannotUseM(),
                        location: { range: util.createRange(2, 47, 2, 48) }
                    }, {
                        ...DiagnosticMessages.arrowFunctionCannotUseM(),
                        location: { range: util.createRange(3, 41, 3, 42) }
                    }]);
                });

                it('flags m regardless of case', () => {
                    program.setFile('source/main.bs', `
                        sub main()
                            getM = () => M
                        end sub
                    `);
                    program.validate();
                    expectDiagnostics(program, [
                        DiagnosticMessages.arrowFunctionCannotUseM()
                    ]);
                });

                it('flags m inside an arrow function in a class', () => {
                    program.setFile('source/main.bs', `
                        class Person
                            name as string
                            callback = () => m.name
                            sub test()
                                f = () => m.name
                            end sub
                        end class
                    `);
                    program.validate();
                    expectDiagnostics(program, [
                        DiagnosticMessages.arrowFunctionCannotUseM(),
                        DiagnosticMessages.arrowFunctionCannotUseM()
                    ]);
                });

                it('flags m inside a nested arrow function', () => {
                    program.setFile('source/main.bs', `
                        sub main()
                            f = (x) => (y) => m.value
                        end sub
                    `);
                    program.validate();
                    expectDiagnostics(program, [
                        DiagnosticMessages.arrowFunctionCannotUseM()
                    ]);
                });

                it('allows m inside a regular anonymous function nested in an arrow function', () => {
                    program.setFile('source/main.bs', `
                        sub main()
                            f = (x) => function()
                                return m.value
                            end function
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });

                it('allows m in the enclosing function around an arrow function', () => {
                    program.setFile('source/main.bs', `
                        sub main()
                            m.callback = (x) => x
                            print m.callback(1)
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });

                it('allows a param named like a member of m to be passed in instead', () => {
                    program.setFile('source/main.bs', `
                        sub main()
                            render = (data, view) => view.setData(data)
                            render({}, m.view)
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });
            });

            describe('allowed references', () => {
                it('allows file-level functions, namespaces and globals', () => {
                    program.setFile('source/main.bs', `
                        namespace alpha
                            function beta(x)
                                return x
                            end function
                            sub main()
                                f = (x) => beta(x)
                                g = (x) => alpha.beta(x)
                                h = (x) => lcase(x)
                            end sub
                        end namespace
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });

                it('allows functions from other files in the same scope', () => {
                    program.setFile('source/lib.bs', `
                        function helper(x)
                            return x
                        end function
                    `);
                    program.setFile('source/main.bs', `
                        sub main()
                            f = (x) => helper(x)
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });

                it('allows enums, consts, classes and interfaces', () => {
                    program.setFile('source/main.bs', `
                        enum Direction
                            up = 1
                        end enum
                        const MAX = 10
                        interface Movie
                            title as string
                        end interface
                        class Person
                            name as string
                        end class
                        sub main()
                            f = (x as integer) => x + Direction.up + MAX
                            g = (movie as Movie) => movie.title
                            h = () => new Person()
                            i = (p as Person) => p.name
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });

                it('validates member access on typed params', () => {
                    expect(getDiagnosticCodes(`
                        class Person
                            name as string
                        end class
                        sub main()
                            f = (p as Person) => p.age
                        end sub
                    `)).to.eql(['cannot-find-name']);
                });
            });

            describe('type checking', () => {
                it('validates against function types', () => {
                    program.setFile('source/main.bs', `
                        sub apply(callback as function(x as integer) as integer)
                        end sub
                        sub main()
                            apply((x as integer) => x * 2)
                            apply((x as string) => x + "!")
                        end sub
                    `);
                    program.validate();
                    expect(program.getDiagnostics().map(diagnostic => diagnostic.code)).to.eql(['argument-type-mismatch']);
                });

                it('validates the param count against function types', () => {
                    expect(getDiagnosticCodes(`
                        sub apply(callback as function(x as integer) as integer)
                        end sub
                        sub main()
                            apply((a as integer, b as integer) => a + b)
                        end sub
                    `)).to.eql(['argument-type-mismatch']);
                });

                it('rejects a void arrow function where a value-returning function is expected', () => {
                    expect(getDiagnosticCodes(`
                        sub apply(callback as function(x as integer) as integer)
                        end sub
                        sub doLog(x)
                        end sub
                        sub main()
                            apply((x as integer) => doLog(x))
                        end sub
                    `)).to.eql(['argument-type-mismatch']);
                });

                it('accepts a void arrow function where a void function is expected', () => {
                    program.setFile('source/main.bs', `
                        sub applySub(callback as sub(x as integer) as void)
                        end sub
                        sub applyFunction(callback as function(x as integer) as void)
                        end sub
                        sub doLog(x)
                        end sub
                        sub main()
                            applySub((x as integer) => doLog(x))
                            applyFunction((x as integer) => doLog(x))
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });

                it('validates calls to an arrow function', () => {
                    expect(getDiagnosticCodes(`
                        sub main()
                            twice = (x as integer) => x * 2
                            print twice("a")
                            print twice()
                            print twice(1, 2)
                        end sub
                    `)).to.eql(['argument-type-mismatch', 'incorrect-argument-count', 'incorrect-argument-count']);
                });

                it('validates the arrow function type in a typed assignment', () => {
                    expect(getDiagnosticCodes(`
                        sub main()
                            good as function(x as integer) as integer = (x as integer) => x
                            bad as function(x as string) as string = (x as integer) => x
                        end sub
                    `)).to.eql(['assignment-type-mismatch']);
                });

                it('validates an arrow function returned from a function', () => {
                    expect(getDiagnosticCodes(`
                        function make() as function(x as integer) as integer
                            return (x as integer) => x
                        end function
                        function makeBad() as function(x as integer) as integer
                            return (x as string) => x
                        end function
                    `)).to.eql(['return-type-mismatch']);
                });

                it('flags a body that does not match the declared return type', () => {
                    expect(getDiagnosticCodes(`
                        sub main()
                            f = (x as integer) as string => x
                        end sub
                    `)).to.eql(['return-type-mismatch']);
                });

                it('flags a void return type with a body that produces a value', () => {
                    expect(getDiagnosticCodes(`
                        sub main()
                            f = (x as integer) as void => x
                        end sub
                    `)).to.eql(['return-type-mismatch']);
                });

                it('uses the inferred return type at call sites', () => {
                    expect(getDiagnosticCodes(`
                        sub main()
                            twice = (x as integer) => x * 2
                            name as string = twice(1)
                        end sub
                    `)).to.eql(['assignment-type-mismatch']);
                });

                it('can be passed to untyped and plain function params', () => {
                    program.setFile('source/main.bs', `
                        sub takesAnything(callback)
                        end sub
                        sub takesDynamic(callback as dynamic)
                        end sub
                        sub takesObject(callback as object)
                        end sub
                        sub takesFunction(callback as function)
                        end sub
                        sub main()
                            takesAnything((x) => x)
                            takesDynamic((x) => x)
                            takesObject((x) => x)
                            takesFunction((x) => x)
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });

                it('can be stored and called through an AA', () => {
                    program.setFile('source/main.bs', `
                        sub main()
                            handlers = { twice: (x as integer) => x * 2 }
                            print handlers.twice(2)
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });
            });

            describe('files', () => {
                it('is not allowed in brs files', () => {
                    program.setFile('source/main.brs', `
                        sub main()
                            f = (x) => x
                        end sub
                    `);
                    program.validate();
                    expectDiagnostics(program, [
                        DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('arrow functions')
                    ]);
                });

                it('works in component scopes', () => {
                    program.setFile('components/Widget.xml', [
                        '<?xml version="1.0" encoding="utf-8" ?>',
                        '<component name="Widget" extends="Group">',
                        '    <script type="text/brighterscript" uri="Widget.bs" />',
                        '</component>'
                    ].join('\n'));
                    program.setFile('components/Widget.bs', `
                        sub init()
                            twice = (x as integer) => x * 2
                            print twice(2)
                        end sub
                    `);
                    program.validate();
                    expectZeroDiagnostics(program);
                });
            });
        });

        describe('editor features', () => {
            it('provides hover for the arrow function, its call site and its params', () => {
                const file = program.setFile<BrsFile>('source/main.bs', [
                    'sub main()',
                    '    twice = (count as integer) => count * 2',
                    '    print twice(4)',
                    'end sub'
                ].join('\n'));
                program.validate();
                expectZeroDiagnostics(program);
                const hoverText = (line: number, character: number) => {
                    return program.getHover(file.srcPath, util.createPosition(line, character)).map(hover => hover.contents).flat().join('\n');
                };
                expect(hoverText(1, 6)).to.include('function (count as integer) as integer');
                expect(hoverText(2, 11)).to.include('function twice(count as integer) as integer');
                expect(hoverText(1, 15)).to.include('count as integer');
                expect(hoverText(1, 36)).to.include('count as integer');
            });

            it('offers params and enclosing locals in completions inside the body', () => {
                const file = program.setFile<BrsFile>('source/main.bs', [
                    'sub main()',
                    '    factor = 2',
                    '    twice = (count as integer) => count * count',
                    'end sub',
                    'function helper()',
                    'end function'
                ].join('\n'));
                program.validate();
                //inside the second `count`. Enclosing locals are offered too, since using one makes the arrow a closure
                const labels = program.getCompletions(file.srcPath, util.createPosition(2, 44)).map(item => item.label);
                expect(labels).to.include('count');
                expect(labels).to.include('helper');
                expect(labels).to.include('factor');
            });

            it('offers member completions on typed params', () => {
                const file = program.setFile<BrsFile>('source/main.bs', [
                    'class Person',
                    '    name as string',
                    'end class',
                    'sub main()',
                    '    getName = (p as Person) => p.',
                    'end sub'
                ].join('\n'));
                program.validate();
                const labels = program.getCompletions(file.srcPath, util.createPosition(4, 33)).map(item => item.label);
                expect(labels).to.include('name');
            });

            it('goes to the definition of a param and of the arrow function', () => {
                const file = program.setFile<BrsFile>('source/main.bs', [
                    'sub main()',
                    '    twice = (count as integer) => count * 2',
                    '    print twice(4)',
                    'end sub'
                ].join('\n'));
                program.validate();
                expectZeroDiagnostics(program);
                //`count` usage in the body -> the param
                let definitions = program.getDefinition(file.srcPath, util.createPosition(1, 36));
                expect(definitions.map(definition => (definition as any).range ?? (definition as any).targetRange)).to.eql([Range.create(1, 13, 1, 18)]);
                //`twice` at the call site -> the assignment
                definitions = program.getDefinition(file.srcPath, util.createPosition(2, 11));
                expect(definitions.map(definition => (definition as any).range ?? (definition as any).targetRange)).to.eql([Range.create(1, 4, 1, 9)]);
            });

            it('marks params as parameters in semantic tokens', () => {
                const file = program.setFile<BrsFile>('source/main.bs', [
                    'sub main()',
                    '    twice = (count as integer) => count * 2',
                    'end sub'
                ].join('\n'));
                program.validate();
                const tokens = program.getSemanticTokens(file.srcPath) ?? [];
                const paramToken = tokens.find(token => token.range.start.line === 1 && token.range.start.character === 13);
                expect(paramToken?.tokenType).to.eql('parameter');
            });
        });
    });
});
