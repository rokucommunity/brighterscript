import { expect } from '../../../chai-config.spec';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Program } from '../../../Program';
import { expectDiagnostics, expectZeroDiagnostics, getTestTranspile, rootDir } from '../../../testHelpers.spec';
import { ParseMode, Parser } from '../../Parser';
import { isClosureType, isFunctionExpression, isTypedFunctionTypeExpression, isVoidType } from '../../../astUtils/reflection';
import { WalkMode } from '../../../astUtils/visitors';
import type { FunctionStatement } from '../../Statement';
import type { FunctionExpression } from '../../Expression';
import { SymbolTypeFlag } from '../../../SymbolTypeFlag';
import type { BrsFile } from '../../../files/BrsFile';
import { util } from '../../../util';

/**
 * Closures: arrow functions that capture variables from the function they are written in.
 * Captured values are copied when the closure is created, and the closure transpiles to `{ ctx: {...}, fn: function(__bsc_ctx, ...) }`
 */
describe('closures', () => {
    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        program.dispose();
    });

    /**
     * Validate `source/main.bs` containing `code` (expecting no diagnostics) and return every arrow function in it
     */
    function getArrowFunctions(code: string) {
        const file = program.setFile<BrsFile>('source/main.bs', code);
        program.validate();
        expectZeroDiagnostics(program);
        return file.ast.findChildren<FunctionExpression>((node) => isFunctionExpression(node) && node.isArrowFunction, { walkMode: WalkMode.visitAllRecursive });
    }

    function getDiagnosticCodes(code: string) {
        program.setFile('source/main.bs', code);
        program.validate();
        return program.getDiagnostics().map(diagnostic => diagnostic.code);
    }

    describe('closure type syntax', () => {
        it('parses a closure type for a parameter', () => {
            const parser = Parser.parse(`
                sub apply(callback as closure(x as integer) as integer)
                end sub
            `, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(parser.diagnostics);
            const param = (parser.ast.statements[0] as FunctionStatement).func.parameters[0];
            expect(isTypedFunctionTypeExpression(param.typeExpression.expression)).to.be.true;
            const type = param.typeExpression.getType({ flags: SymbolTypeFlag.typetime });
            expect(isClosureType(type)).to.be.true;
            expect(type.toString()).to.eql('closure (x as integer) as integer');
            //closures are AAs at runtime
            expect(type.toTypeString()).to.eql('object');
        });

        it('parses a closure return type', () => {
            const parser = Parser.parse(`
                function make() as closure(x as integer) as integer
                    return (x as integer) => x
                end function
            `, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(parser.diagnostics);
            const func = (parser.ast.statements[0] as FunctionStatement).func;
            expect(isClosureType(func.returnTypeExpression.getType({ flags: SymbolTypeFlag.typetime }))).to.be.true;
        });

        it('keeps `closure` usable as an ordinary identifier', () => {
            const parser = Parser.parse(`
                sub main()
                    closure = 1
                    print closure
                end sub
            `, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(parser.diagnostics);
        });

        it('transpiles closure-typed params and return types to object', async () => {
            await testTranspile(`
                function make(callback as closure(x as integer) as integer) as closure(x as integer) as integer
                    return callback
                end function
            `, `
                function make(callback as object) as object
                    return callback
                end function
            `);
        });
    });

    describe('capture analysis', () => {
        it('captures a local of the enclosing function', () => {
            const [func] = getArrowFunctions(`
                sub main()
                    factor = 2
                    scale = (x as integer) => x * factor
                    print scale(1)
                end sub
            `);
            expect(func.isClosure).to.be.true;
            expect(util.getClosureCapturedVariables(func)).to.eql(['factor']);
        });

        it('captures a parameter of the enclosing function', () => {
            const [func] = getArrowFunctions(`
                sub main(factor as integer)
                    scale = (x as integer) => x * factor
                    print scale(1)
                end sub
            `);
            expect(util.getClosureCapturedVariables(func)).to.eql(['factor']);
        });

        it('captures several variables once each, in the order they are first referenced', () => {
            const [func] = getArrowFunctions(`
                sub main(prefix as string)
                    suffix = "!"
                    greet = (name as string) => prefix + name + suffix + prefix
                    print greet("bob")
                end sub
            `);
            expect(util.getClosureCapturedVariables(func)).to.eql(['prefix', 'suffix']);
        });

        it('orders captures by first reference, not alphabetically or by declaration', () => {
            const [func] = getArrowFunctions(`
                sub main()
                    a = 1
                    b = 2
                    c = 3
                    f = () => c + a + b
                    print f()
                end sub
            `);
            expect(util.getClosureCapturedVariables(func)).to.eql(['c', 'a', 'b']);
        });

        it('captures a variable used in a default param value', () => {
            const [func] = getArrowFunctions(`
                sub main()
                    factor = 2
                    f = (x = factor) => x
                    print f()
                end sub
            `);
            expect(util.getClosureCapturedVariables(func)).to.eql(['factor']);
        });

        it('captures a variable used through a member access', () => {
            const [func] = getArrowFunctions(`
                sub main()
                    config = { factor: 2 }
                    scale = (x as integer) => x * config.factor
                    print scale(1)
                end sub
            `);
            expect(util.getClosureCapturedVariables(func)).to.eql(['config']);
        });

        it('captures a loop variable and a catch variable', () => {
            const funcs = getArrowFunctions(`
                sub main(items as integer[])
                    for each item in items
                        f = () => item
                        print f()
                    end for
                    try
                        print 1
                    catch e
                        g = () => e
                        print g()
                    end try
                end sub
            `);
            expect(funcs.map(arrow => util.getClosureCapturedVariables(arrow))).to.eql([['item'], ['e']]);
        });

        it('captures a local declared after the closure', () => {
            //allowed syntactically (BrightScript locals are function-scoped); the value is whatever it is at creation time
            const [func] = getArrowFunctions(`
                sub main()
                    later = 1
                    f = () => later
                    print f()
                end sub
            `);
            expect(util.getClosureCapturedVariables(func)).to.eql(['later']);
        });

        it('captures through nested arrow functions', () => {
            const [outer, inner] = getArrowFunctions(`
                sub main(suffix as string)
                    outer = (a as integer) => (b as integer) => a + b + len(suffix)
                    print outer(1)
                end sub
            `);
            //the inner closure needs `a` (the outer param) and `suffix`; the outer must capture `suffix` so the inner can be built from it
            expect(util.getClosureCapturedVariables(inner)).to.eql(['a', 'suffix']);
            expect(util.getClosureCapturedVariables(outer)).to.eql(['suffix']);
        });

        it('does not capture its own params, file-level functions, namespaces, classes, enums or consts', () => {
            const [func] = getArrowFunctions(`
                namespace alpha
                    function beta(x)
                        return x
                    end function
                end namespace
                enum Direction
                    up = 1
                end enum
                const MAX = 10
                class Person
                end class
                sub main()
                    f = (x) => alpha.beta(x) + Direction.up + MAX + len(type(new Person()))
                    print f(1)
                end sub
            `);
            expect(func.isClosure).to.be.false;
            expect(util.getClosureCapturedVariables(func)).to.eql([]);
        });

        it('does not treat a regular anonymous function nested inside the arrow as capturing', () => {
            //the inner regular function can't see `factor` (it is not a closure), so it is reported as unknown there
            expect(getDiagnosticCodes(`
                sub main()
                    factor = 2
                    f = (x) => function()
                        return factor
                    end function
                end sub
            `)).to.eql(['cannot-find-name']);
        });
    });

    describe('transpile', () => {
        it('transpiles a closure to an AA holding the captured values and a function that unpacks them', async () => {
            await testTranspile(`
                sub main()
                    factor = 2
                    scale = (x as integer) => x * factor
                end sub
            `, `
                sub main()
                    factor = 2
                    scale = {
                        ctx: {
                            factor: factor
                        }
                        fn: function(__bsc_ctx, x as integer)
                            factor = __bsc_ctx.factor
                            return x * factor
                        end function
                    }
                end sub
            `);
        });

        it('transpiles several captured variables', async () => {
            await testTranspile(`
                sub main(prefix as string)
                    suffix = "!"
                    greet = (name as string) => prefix + name + suffix
                end sub
            `, `
                sub main(prefix as string)
                    suffix = "!"
                    greet = {
                        ctx: {
                            prefix: prefix
                            suffix: suffix
                        }
                        fn: function(__bsc_ctx, name as string)
                            prefix = __bsc_ctx.prefix
                            suffix = __bsc_ctx.suffix
                            return prefix + name + suffix
                        end function
                    }
                end sub
            `);
        });

        it('transpiles nested closures, building the inner one from the outer one\'s unpacked values', async () => {
            await testTranspile(`
                sub main(suffix as string)
                    outer = (a as integer) => (b as integer) => a + b + len(suffix)
                end sub
            `, `
                sub main(suffix as string)
                    outer = {
                        ctx: {
                            suffix: suffix
                        }
                        fn: function(__bsc_ctx, a as integer)
                            suffix = __bsc_ctx.suffix
                            return {
                                ctx: {
                                    a: a
                                    suffix: suffix
                                }
                                fn: function(__bsc_ctx, b as integer)
                                    a = __bsc_ctx.a
                                    suffix = __bsc_ctx.suffix
                                    return a + b + len(suffix)
                                end function
                            }
                        end function
                    }
                end sub
            `);
        });

        it('transpiles a closure whose body calls a sub to a sub', async () => {
            await testTranspile(`
                sub main(view as object)
                    render = (data as string) => show(view, data)
                end sub
                sub show(view as object, data as string)
                end sub
            `, `
                sub main(view as object)
                    render = {
                        ctx: {
                            view: view
                        }
                        fn: sub(__bsc_ctx, data as string)
                            view = __bsc_ctx.view
                            show(view, data)
                        end sub
                    }
                end sub

                sub show(view as object, data as string)
                end sub
            `);
        });

        it('transpiles an arrow function passed to a closure-typed param as a closure, even without captures', async () => {
            await testTranspile(`
                sub apply(callback as closure(x as integer) as integer)
                end sub
                sub main()
                    apply((x as integer) => x * 2)
                end sub
            `, `
                sub apply(callback as object)
                end sub

                sub main()
                    apply({
                        ctx: {}
                        fn: function(__bsc_ctx, x as integer)
                            return x * 2
                        end function
                    })
                end sub
            `);
        });

        it('transpiles an arrow function assigned to a closure-typed variable as a closure', async () => {
            await testTranspile(`
                sub main()
                    twice as closure(x as integer) as integer = (x as integer) => x * 2
                end sub
            `, `
                sub main()
                    twice = {
                        ctx: {}
                        fn: function(__bsc_ctx, x as integer)
                            return x * 2
                        end function
                    }
                end sub
            `);
        });

        it('leaves arrow functions that capture nothing as plain functions', async () => {
            await testTranspile(`
                sub main()
                    twice = (x as integer) => x * 2
                    print twice(2)
                end sub
            `, `
                sub main()
                    twice = function(x as integer)
                        return x * 2
                    end function
                    print twice(2)
                end sub
            `);
        });
    });

    describe('calling closures', () => {
        it('calls a closure held in a local variable', async () => {
            await testTranspile(`
                sub main()
                    factor = 2
                    scale = (x as integer) => x * factor
                    print scale(10)
                    result = scale(3) + scale(4)
                end sub
            `, `
                sub main()
                    factor = 2
                    scale = {
                        ctx: {
                            factor: factor
                        }
                        fn: function(__bsc_ctx, x as integer)
                            factor = __bsc_ctx.factor
                            return x * factor
                        end function
                    }
                    print scale.fn(scale.ctx, 10)
                    result = scale.fn(scale.ctx, 3) + scale.fn(scale.ctx, 4)
                end sub
            `);
        });

        it('calls a closure-typed parameter', async () => {
            await testTranspile(`
                sub apply(callback as closure(x as integer) as integer)
                    print callback(1)
                end sub
            `, `
                sub apply(callback as object)
                    print callback.fn(callback.ctx, 1)
                end sub
            `);
        });

        it('calls a closure with no arguments', async () => {
            await testTranspile(`
                sub main()
                    count = 1
                    get = () => count
                    print get()
                end sub
            `, `
                sub main()
                    count = 1
                    get = {
                        ctx: {
                            count: count
                        }
                        fn: function(__bsc_ctx)
                            count = __bsc_ctx.count
                            return count
                        end function
                    }
                    print get.fn(get.ctx)
                end sub
            `);
        });

        it('calls a void closure as a statement', async () => {
            await testTranspile(`
                sub main(view as object)
                    render = (data as string) => show(view, data)
                    render("x")
                end sub
                sub show(view as object, data as string)
                end sub
            `, `
                sub main(view as object)
                    render = {
                        ctx: {
                            view: view
                        }
                        fn: sub(__bsc_ctx, data as string)
                            view = __bsc_ctx.view
                            show(view, data)
                        end sub
                    }
                    render.fn(render.ctx, "x")
                end sub

                sub show(view as object, data as string)
                end sub
            `);
        });

        it('calls a closure stored in a typed class field', async () => {
            program.setFile('source/main.bs', `
                class Thing
                    callback as closure(x as integer) as integer
                end class
                sub main()
                    factor = 3
                    t = new Thing()
                    t.callback = (x as integer) => x * factor
                    print t.callback(2)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const result = await program.getTranspiledFileContents('source/main.bs');
            expect(result.code).to.include('print t.callback.fn(t.callback.ctx, 2)');
        });

        it('calls a closure returned from a function', async () => {
            await testTranspile(`
                function makeScaler(factor as integer) as closure(x as integer) as integer
                    return (x as integer) => x * factor
                end function
                sub main()
                    scaler = makeScaler(2)
                    print scaler(5)
                end sub
            `, `
                function makeScaler(factor as integer) as object
                    return {
                        ctx: {
                            factor: factor
                        }
                        fn: function(__bsc_ctx, x as integer)
                            factor = __bsc_ctx.factor
                            return x * factor
                        end function
                    }
                end function

                sub main()
                    scaler = makeScaler(2)
                    print scaler.fn(scaler.ctx, 5)
                end sub
            `);
        });

        it('wraps a call on a complex callee so the closure is evaluated once', async () => {
            await testTranspile(`
                function makeScaler(factor as integer) as closure(x as integer) as integer
                    return (x as integer) => x * factor
                end function
                sub main()
                    print makeScaler(2)(5)
                end sub
            `, `
                function makeScaler(factor as integer) as object
                    return {
                        ctx: {
                            factor: factor
                        }
                        fn: function(__bsc_ctx, x as integer)
                            factor = __bsc_ctx.factor
                            return x * factor
                        end function
                    }
                end function

                sub main()
                    print (function(__bsc_closure, __bsc_arg0)
                        return __bsc_closure.fn(__bsc_closure.ctx, __bsc_arg0)
                    end function)(makeScaler(2), 5)
                end sub
            `);
        });

        it('validates arguments of closure calls', () => {
            expect(getDiagnosticCodes(`
                sub main()
                    factor = 2
                    scale = (x as integer) => x * factor
                    print scale("a")
                    print scale()
                end sub
            `)).to.eql(['argument-type-mismatch', 'incorrect-argument-count']);
        });

        it('uses the closure return type at call sites', () => {
            expect(getDiagnosticCodes(`
                sub main()
                    factor = 2
                    scale = (x as integer) => x * factor
                    name as string = scale(1)
                end sub
            `)).to.eql(['assignment-type-mismatch']);
        });
    });

    describe('types', () => {
        it('types a capturing arrow function as a closure', () => {
            const [func] = getArrowFunctions(`
                sub main()
                    factor = 2
                    scale = (x as integer) => x * factor
                    print scale(1)
                end sub
            `);
            const type = func.getType({ flags: SymbolTypeFlag.runtime });
            expect(isClosureType(type)).to.be.true;
            expect(type.toString()).to.eql('closure (x as integer) as integer');
        });

        it('types a void closure as a closure returning void', () => {
            const [func] = getArrowFunctions(`
                sub main(view as object)
                    render = (data as string) => show(view, data)
                    render("x")
                end sub
                sub show(view as object, data as string)
                end sub
            `);
            const type = func.getType({ flags: SymbolTypeFlag.runtime });
            expect(isClosureType(type)).to.be.true;
            expect(isVoidType(type.returnType)).to.be.true;
        });

        it('shows the closure type on hover for the variable and the call site', () => {
            const file = program.setFile<BrsFile>('source/main.bs', [
                'sub main()',
                '    factor = 2',
                '    scale = (x as integer) => x * factor',
                '    print scale(10)',
                'end sub'
            ].join('\n'));
            program.validate();
            expectZeroDiagnostics(program);
            const hoverText = (line: number, character: number) => {
                return program.getHover(file.srcPath, util.createPosition(line, character)).map(hover => hover.contents).flat().join('\n');
            };
            expect(hoverText(2, 5)).to.include('closure (x as integer) as integer');
            expect(hoverText(3, 11)).to.include('closure scale(x as integer) as integer');
        });
    });

    describe('validation', () => {
        describe('captured variables are copied at creation time', () => {
            it('flags assigning a captured variable after the closure is created', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        count = 1
                        get = () => count
                        count = 2
                        print get()
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.closureCapturedVariableReassigned('count')
                ]);
            });

            it('flags augmented assignment and increment of a captured variable', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        count = 1
                        get = () => count
                        count += 1
                        count++
                        print get()
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.closureCapturedVariableReassigned('count'),
                    DiagnosticMessages.closureCapturedVariableReassigned('count')
                ]);
            });

            it('flags re-declaring a captured variable in a later loop', () => {
                program.setFile('source/main.bs', `
                    sub main(items as integer[])
                        item = 1
                        get = () => item
                        for each item in items
                            print item
                        end for
                        print get()
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.closureCapturedVariableReassigned('item')
                ]);
            });

            it('allows assignments before the closure and inside other functions', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        count = 1
                        count = 2
                        get = () => count
                        other = function()
                            count = 3
                            return count
                        end function
                        print get()
                        print other()
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows a loop variable to be captured inside the loop', () => {
                //each iteration creates a new closure holding that iteration's value
                program.setFile('source/main.bs', `
                    sub main(items as integer[])
                        for each item in items
                            f = () => item
                            print f()
                        end for
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });

        describe('closures are not plain functions', () => {
            it('cannot be passed to a function-typed param', () => {
                program.setFile('source/main.bs', `
                    sub apply(callback as function(x as integer) as integer)
                    end sub
                    sub main()
                        factor = 2
                        apply((x as integer) => x * factor)
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.closureNotCompatibleWithParameter('function (x as integer) as integer')
                ]);
            });

            it('cannot be passed to untyped, dynamic, object or function params', () => {
                expect(getDiagnosticCodes(`
                    sub takesAnything(callback)
                    end sub
                    sub takesDynamic(callback as dynamic)
                    end sub
                    sub takesObject(callback as object)
                    end sub
                    sub takesFunction(callback as function)
                    end sub
                    sub main()
                        factor = 2
                        scale = (x as integer) => x * factor
                        takesAnything(scale)
                        takesDynamic(scale)
                        takesObject(scale)
                        takesFunction(scale)
                    end sub
                `)).to.eql([
                    'closure-not-compatible-with-parameter',
                    'closure-not-compatible-with-parameter',
                    'closure-not-compatible-with-parameter',
                    'closure-not-compatible-with-parameter'
                ]);
            });

            it('can be passed to a closure-typed param', () => {
                program.setFile('source/main.bs', `
                    sub apply(callback as closure(x as integer) as integer)
                        print callback(1)
                    end sub
                    sub main()
                        factor = 2
                        scale = (x as integer) => x * factor
                        apply(scale)
                        apply((x as integer) => x * factor)
                        apply((x as integer) => x * 2)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates the signature against a closure-typed param', () => {
                expect(getDiagnosticCodes(`
                    sub apply(callback as closure(x as integer) as integer)
                    end sub
                    sub main()
                        factor = "a"
                        apply((x as string) => x + factor)
                    end sub
                `)).to.eql(['argument-type-mismatch']);
            });

            it('does not accept a plain function where a closure is expected', () => {
                expect(getDiagnosticCodes(`
                    sub apply(callback as closure(x as integer) as integer)
                    end sub
                    function twice(x as integer) as integer
                        return x * 2
                    end function
                    sub main()
                        apply(twice)
                        apply(function(x as integer) as integer
                            return x
                        end function)
                    end sub
                `)).to.eql(['argument-type-mismatch', 'argument-type-mismatch']);
            });

            it('requires a closure return type when returning a closure', () => {
                expect(getDiagnosticCodes(`
                    function makeScaler(factor as integer)
                        return (x as integer) => x * factor
                    end function
                `)).to.eql(['return-type-mismatch']);
            });

            it('accepts a closure return type when returning a closure', () => {
                program.setFile('source/main.bs', `
                    function makeScaler(factor as integer) as closure(x as integer) as integer
                        return (x as integer) => x * factor
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('rejects a closure assigned to a function-typed variable', () => {
                expect(getDiagnosticCodes(`
                    sub main()
                        factor = 2
                        bad as function(x as integer) as integer = (x as integer) => x * factor
                    end sub
                `)).to.eql(['assignment-type-mismatch']);
            });
        });

        it('still does not allow m inside a closure', () => {
            program.setFile('source/main.bs', `
                sub main()
                    factor = 2
                    f = (x) => m.value * factor
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.arrowFunctionCannotUseM()
            ]);
        });
    });
});
