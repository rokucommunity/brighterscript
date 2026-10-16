import { expect } from '../../../chai-config.spec';
import { Range } from 'vscode-languageserver';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Program } from '../../../Program';
import { expectDiagnostics, expectZeroDiagnostics, getTestTranspile, rootDir } from '../../../testHelpers.spec';
import { ParseMode, Parser } from '../../Parser';
import { isAALiteralExpression, isBinaryExpression, isCallExpression, isFunctionExpression, isGroupingExpression, isLiteralExpression, isReturnStatement, isTernaryExpression, isTypecastExpression, isVoidType } from '../../../astUtils/reflection';
import { WalkMode } from '../../../astUtils/visitors';
import type { AssignmentStatement, FunctionStatement } from '../../Statement';
import type { BinaryExpression, CallExpression, FunctionExpression, GroupingExpression } from '../../Expression';
import { SymbolTypeFlag } from '../../../SymbolTypeFlag';
import type { BrsFile } from '../../../files/BrsFile';

describe('arrow functions', () => {
    /**
     * Parse `code` as the only statement of a function body and return the value of its assignment
     */
    function parseValue(code: string) {
        const parser = Parser.parse(`sub main()\n    ${code}\nend sub`, { mode: ParseMode.BrighterScript });
        expectZeroDiagnostics(parser.diagnostics);
        const assignment = (parser.ast.statements[0] as FunctionStatement).func.body.statements[0] as AssignmentStatement;
        return assignment.value;
    }

    function parseArrow(code: string) {
        const value = parseValue(code);
        expect(isFunctionExpression(value), 'expected an arrow function').to.be.true;
        const func = value as FunctionExpression;
        expect(func.isArrowFunction).to.be.true;
        return func;
    }

    describe('parser', () => {
        it('parses an arrow function with no params', () => {
            const func = parseArrow('getZero = () => 0');
            expect(func.parameters).to.be.empty;
            expect(isLiteralExpression(func.arrowBody)).to.be.true;
            //the body is stored as a `return` statement, and there are no function keywords
            expect(func.body.statements).to.have.lengthOf(1);
            expect(isReturnStatement(func.body.statements[0])).to.be.true;
            expect(func.tokens.functionType).to.be.undefined;
            expect(func.tokens.endFunctionType).to.be.undefined;
        });

        it('parses a single param', () => {
            const func = parseArrow('twice = (x) => x * 2');
            expect(func.parameters.map(p => p.tokens.name.text)).to.eql(['x']);
            expect(isBinaryExpression(func.arrowBody)).to.be.true;
        });

        it('parses typed params and a return type', () => {
            const func = parseArrow('add = (a as integer, b as integer) as integer => a + b');
            expect(func.parameters.map(p => p.tokens.name.text)).to.eql(['a', 'b']);
            expect(func.parameters[0].typeExpression.getType({ flags: SymbolTypeFlag.typetime }).toString()).to.eql('integer');
            expect(func.returnTypeExpression.getType({ flags: SymbolTypeFlag.typetime }).toString()).to.eql('integer');
        });

        it('parses default param values', () => {
            const func = parseArrow('greet = (name = "world") => "hello " + name');
            expect(func.parameters[0].defaultValue).to.exist;
        });

        it('parses an arrow function as a call argument', () => {
            const value = parseValue('result = filter(items, (i) => i.rating > 3.5)');
            expect(isCallExpression(value)).to.be.true;
            const arg = (value as CallExpression).args[1];
            expect(isFunctionExpression(arg) && arg.isArrowFunction).to.be.true;
        });

        it('parses a parenthesized AA literal body', () => {
            const func = parseArrow('makePoint = (x, y) => ({ x: x, y: y })');
            expect(isGroupingExpression(func.arrowBody)).to.be.true;
            expect(isAALiteralExpression((func.arrowBody as GroupingExpression).expression)).to.be.true;
        });

        it('extends the body as far right as possible', () => {
            const func = parseArrow('pick = (a) => a ? 1 : 2');
            expect(isTernaryExpression(func.arrowBody)).to.be.true;
        });

        it('parses nested arrow functions', () => {
            const outer = parseArrow('f = (a) => (b) => b');
            expect(isFunctionExpression(outer.arrowBody) && outer.arrowBody.isArrowFunction).to.be.true;
        });

        it('spans from the open paren to the end of the body', () => {
            const func = parseArrow('twice = (x) => x * 2');
            //    twice = (x) => x * 2
            expect(func.location.range).to.eql(Range.create(1, 12, 1, 24));
        });

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

        it('still parses a parenthesized comparison', () => {
            const value = parseValue('x = (a = 1)');
            expect(isGroupingExpression(value)).to.be.true;
            expect(isBinaryExpression((value as GroupingExpression).expression)).to.be.true;
        });

        it('flags a missing body', () => {
            const parser = Parser.parse(`sub main()\n    x = (a) =>\nend sub`, { mode: ParseMode.BrighterScript });
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

        it('is not allowed in brightscript mode', () => {
            const parser = Parser.parse(`sub main()\n    f = (a) => a\nend sub`, { mode: ParseMode.BrightScript });
            expectDiagnostics(parser.diagnostics, [
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('arrow functions')
            ]);
        });

        it('clones', () => {
            const func = parseArrow('twice = (x) => x * 2');
            const clone = func.clone();
            expect(clone.isArrowFunction).to.be.true;
            expect(clone.arrowBody).to.exist;
            expect(clone.tokens.arrow).not.to.equal(func.tokens.arrow);
        });
    });

    describe('program', () => {
        let program: Program;
        const testTranspile = getTestTranspile(() => [program, rootDir]);

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
        });

        describe('validation', () => {
            it('infers the return type from the body', () => {
                const func = getArrowFunction(`
                    sub main()
                        twice = (x as integer) => x * 2
                        print twice(2)
                    end sub
                `);
                expect(func.getType({ flags: SymbolTypeFlag.runtime }).toString()).to.eql('function (x as integer) as integer');
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

            it('flags a captured local variable', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        factor = 2
                        scale = (x) => x * factor
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.arrowFunctionCannotCaptureVariable('factor')
                ]);
            });

            it('flags a captured parameter', () => {
                program.setFile('source/main.bs', `
                    sub main(factor)
                        scale = (x) => x * factor
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.arrowFunctionCannotCaptureVariable('factor')
                ]);
            });

            it('flags a captured variable that is called as a function', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        callback = function(x)
                            return x
                        end function
                        f = (x) => callback(x)
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.arrowFunctionCannotCaptureVariable('callback')
                ]);
            });

            it('flags a variable captured from an enclosing arrow function', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        f = (a) => (b) => a + b
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.arrowFunctionCannotCaptureVariable('a')
                ]);
            });

            it('flags m', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        render = (data) => m.view.setData(data)
                        getM = () => m
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.arrowFunctionCannotUseM(),
                    DiagnosticMessages.arrowFunctionCannotUseM()
                ]);
            });

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
                expect(program.getDiagnostics().map(x => x.code)).to.eql(['argument-type-mismatch']);
            });

            it('flags a body that does not match the declared return type', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        f = (x as integer) as string => x
                    end sub
                `);
                program.validate();
                expect(program.getDiagnostics().map(x => x.code)).to.eql(['return-type-mismatch']);
            });

            it('can be passed to untyped and plain function params', () => {
                program.setFile('source/main.bs', `
                    sub takesAnything(callback)
                    end sub
                    sub takesFunction(callback as function)
                    end sub
                    sub main()
                        takesAnything((x) => x)
                        takesFunction((x) => x)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

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
        });
    });
});
