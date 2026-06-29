import { expect } from '../../chai-config.spec';
import type { BrsFile } from '../../files/BrsFile';
import type { AALiteralExpression, DottedGetExpression } from '../../parser/Expression';
import type { ClassStatement, FunctionStatement, NamespaceStatement, PrintStatement } from '../../parser/Statement';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { expectDiagnostics, expectZeroDiagnostics, tempDir, trim } from '../../testHelpers.spec';
import { Program } from '../../Program';
import { isClassStatement, isNamespaceStatement } from '../../astUtils/reflection';
import util from '../../util';
import * as fsExtra from 'fs-extra';

describe('BrsFileValidator', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({});
    });

    it('links dotted get expression parents', () => {
        const file = program.setFile<BrsFile>('source/main.bs', `
            sub main()
                print {}.beta.charlie
            end sub
        `);
        program.validate();
        const func = (file.parser.ast.statements[0] as FunctionStatement);
        const print = func.func.body.statements[0] as PrintStatement;
        expect(print.parent).to.equal(func.func.body);

        const charlie = print.expressions[0] as DottedGetExpression;
        expect(charlie.parent).to.equal(print);

        const beta = charlie.obj as DottedGetExpression;
        expect(beta.parent).to.equal(charlie);

        const aaLiteral = beta.obj as AALiteralExpression;
        expect(aaLiteral.parent).to.equal(beta);
    });

    it('links NamespacedVariableNameExpression dotted get parents', () => {
        const { ast } = program.setFile<BrsFile>('source/main.bs', `
            namespace alpha.bravo
                class Delta extends alpha.bravo.Charlie
                end class
                class Charlie
                end class
            end namespace
        `);
        const namespace = ast.findChild<NamespaceStatement>(isNamespaceStatement)!;
        const deltaClass = namespace.findChild<ClassStatement>(isClassStatement)!;
        expect(deltaClass.parent).to.equal(namespace.body);

        const charlie = (deltaClass.parentClassName!.expression as DottedGetExpression);
        expect(charlie.parent).to.equal(deltaClass.parentClassName);

        const bravo = charlie.obj as DottedGetExpression;
        expect(bravo.parent).to.equal(charlie);

        const alpha = bravo.obj as DottedGetExpression;
        expect(alpha.parent).to.equal(bravo);
    });

    describe('namespace validation', () => {
        it('succeeds if namespaces are defined inside other namespaces', () => {
            program.setFile<BrsFile>('source/main.bs', `
                namespace alpha
                    ' random comment
                    namespace bravo
                        ' random comment
                        sub main()
                        end sub
                    end namespace
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
        it('fails if namespaces are defined inside a function', () => {
            program.setFile<BrsFile>('source/main.bs', `
                function f()
                    namespace alpha
                    end namespace
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('namespace')
            ]);
        });
    });

    it('allows classes in correct locations', () => {
        program.setFile('source/main.bs', `
            class Alpha
            end class
            namespace Beta
                class Charlie
                end class
                namespace Delta
                    class Echo
                    end class
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags classes in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                class Alpha
                end class
                if true then
                    class Beta
                    end class
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('class'),
            range: util.createRange(2, 16, 2, 27)
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('class'),
            range: util.createRange(5, 20, 5, 30)
        }]);
    });

    it('allows enums in correct locations', () => {
        program.setFile('source/main.bs', `
            enum Alpha
                value1
            end enum
            namespace Beta
                enum Charlie
                    value1
                end enum
                namespace Delta
                    enum Echo
                        value1
                    end enum
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags enums in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                enum Alpha
                    value1
                end enum
                if true then
                    enum Beta
                        value1
                    end enum
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('enum'),
            range: util.createRange(2, 16, 2, 26)
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('enum'),
            range: util.createRange(6, 20, 6, 29)
        }]);
    });

    it('allows functions in correct locations', () => {
        program.setFile('source/main.bs', `
            function Alpha()
            end function
            namespace Beta
                function Charlie()
                end function
                namespace Delta
                    function Echo()
                    end function
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags functions in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                function Alpha()
                end function
                if true then
                    function Beta()
                    end function
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('function'),
            range: util.createRange(2, 16, 2, 30)
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('function'),
            range: util.createRange(5, 20, 5, 33)
        }]);
    });

    it('allows namespaces in correct locations', () => {
        program.setFile('source/main.bs', `
            namespace Alpha
            end namespace
            namespace Beta
                namespace Charlie
                end namespace
                namespace Delta
                    namespace Echo
                    end namespace
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags classes in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                namespace Alpha
                end namespace
                if true then
                    namespace Beta
                    end namespace
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('namespace'),
            range: util.createRange(2, 16, 2, 31)
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('namespace'),
            range: util.createRange(5, 20, 5, 34)
        }]);
    });

    it('allows interfaces in correct locations', () => {
        program.setFile('source/main.bs', `
            interface Alpha
                prop as string
            end interface
            namespace Beta
                interface Charlie
                    prop as string
                end interface
                namespace Delta
                    interface Echo
                        prop as string
                    end interface
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags interfaces in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                interface Alpha
                    prop as string
                end interface
                if true then
                    interface Beta
                        prop as string
                    end interface
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('interface'),
            range: util.createRange(2, 16, 2, 31)
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('interface'),
            range: util.createRange(6, 20, 6, 34)
        }]);
    });

    it('allows consts in correct locations', () => {
        program.setFile('source/main.bs', `
            const Alpha = 1
            namespace Beta
                const Charlie = 2
                namespace Delta
                    const Echo = 3
                end namespace
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags consts in wrong locations', () => {
        program.setFile('source/main.bs', `
            function test()
                const Alpha = 1
                if true then
                    const Beta = 2
                end if
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('const'),
            range: util.createRange(2, 16, 2, 27)
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('const'),
            range: util.createRange(4, 20, 4, 30)
        }]);
    });

    describe('function return values', () => {

        it('catches sub with return value', () => {
            program.setFile('source/main.brs', `
                sub test()
                    return true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                range: util.createRange(2, 20, 2, 31)
            }]);
        });

        it('catches sub as void with return value', () => {
            program.setFile('source/main.brs', `
                sub test() as void
                    return true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                range: util.createRange(2, 20, 2, 31)
            }]);
        });

        it('catches function as void with return value', () => {
            program.setFile('source/main.brs', `
                function test() as void
                    return true
                end function
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.voidFunctionMayNotReturnValue('function'),
                range: util.createRange(2, 20, 2, 31)
            }]);
        });

        it('catches sub as <type> without return value', () => {
            program.setFile('source/main.brs', `
                sub test() as integer
                    return
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.nonVoidFunctionMustReturnValue('sub'),
                range: util.createRange(2, 20, 2, 26)
            }]);
        });

        it('catches function without return value', () => {
            program.setFile('source/main.brs', `
                function test()
                    return
                end function
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.nonVoidFunctionMustReturnValue('function'),
                range: util.createRange(2, 20, 2, 26)
            }]);
        });

        it('catches function as <type> without return value', () => {
            program.setFile('source/main.brs', `
                function test() as integer
                    return
                end function
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.nonVoidFunctionMustReturnValue('function'),
                range: util.createRange(2, 20, 2, 26)
            }]);
        });

        it('catches anon sub with return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = sub()
                        return true
                    end sub
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                range: util.createRange(3, 24, 3, 35)
            }]);
        });

        it('catches sub as void with return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = sub() as void
                        return true
                    end sub
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                range: util.createRange(3, 24, 3, 35)
            }]);
        });

        it('catches function as void with return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = function() as void
                        return true
                    end function
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.voidFunctionMayNotReturnValue('function'),
                range: util.createRange(3, 24, 3, 35)
            }]);
        });

        it('catches sub as <type> without return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = sub() as integer
                        return
                    end sub
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.nonVoidFunctionMustReturnValue('sub'),
                range: util.createRange(3, 24, 3, 30)
            }]);
        });

        it('catches function without return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = function()
                        return
                    end function
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.nonVoidFunctionMustReturnValue('function'),
                range: util.createRange(3, 24, 3, 30)
            }]);
        });

        it('catches function as <type> without return value', () => {
            program.setFile('source/main.brs', `
                sub main()
                    test = function() as integer
                        return
                    end function
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.nonVoidFunctionMustReturnValue('function'),
                range: util.createRange(3, 24, 3, 30)
            }]);
        });
    });

    describe('minFirmwareVersion', () => {
        describe('optional chaining', () => {
            it('allows optional chaining in .brs files when minFirmwareVersion is not set', () => {
                program.setFile('source/main.brs', `
                    sub main()
                        obj = {}
                        value = obj?.name
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows optional chaining in .bs files when minFirmwareVersion is not set', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        obj = {}
                        value = obj?.name
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows optional chaining in .brs files when minFirmwareVersion is 11.0.0', () => {
                program = new Program({ minFirmwareVersion: '11.0.0' });
                program.setFile('source/main.brs', `
                    sub main()
                        obj = {}
                        value = obj?.name
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows optional chaining in .bs files when minFirmwareVersion is 11.0.0', () => {
                program = new Program({ minFirmwareVersion: '11.0.0' });
                program.setFile('source/main.bs', `
                    sub main()
                        obj = {}
                        value = obj?.name
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows optional chaining in .brs files when minFirmwareVersion is above 11.0.0', () => {
                program = new Program({ minFirmwareVersion: '12.0.0' });
                program.setFile('source/main.brs', `
                    sub main()
                        obj = {}
                        value = obj?.name
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('flags optional chaining (dotted get) in .brs files when minFirmwareVersion is below 11.0.0', () => {
                program = new Program({ minFirmwareVersion: '10.0.0' });
                program.setFile('source/main.brs', `
                    sub main()
                        obj = {}
                        value = obj?.name
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.featureRequiresMinFirmwareVersion('optional chaining', '11.0.0', '10.0.0')
                }]);
            });

            it('flags optional chaining (dotted get) in .bs files when minFirmwareVersion is below 11.0.0', () => {
                program = new Program({ minFirmwareVersion: '10.0.0' });
                program.setFile('source/main.bs', `
                    sub main()
                        obj = {}
                        value = obj?.name
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.featureRequiresMinFirmwareVersion('optional chaining', '11.0.0', '10.0.0')
                }]);
            });

            it('flags optional chaining (indexed get) in .brs files when minFirmwareVersion is below 11.0.0', () => {
                program = new Program({ minFirmwareVersion: '10.0.0' });
                program.setFile('source/main.brs', `
                    sub main()
                        arr = []
                        value = arr?[0]
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.featureRequiresMinFirmwareVersion('optional chaining', '11.0.0', '10.0.0')
                }]);
            });

            it('flags optional chaining (call expression) in .brs files when minFirmwareVersion is below 11.0.0', () => {
                program = new Program({ minFirmwareVersion: '10.0.0' });
                program.setFile('source/main.brs', `
                    sub main()
                        obj = {}
                        obj.doSomething?()
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.featureRequiresMinFirmwareVersion('optional chaining', '11.0.0', '10.0.0')
                }]);
            });
        });
    });

    describe('eval deprecation', () => {
        beforeEach(() => {
            fsExtra.ensureDirSync(tempDir);
            fsExtra.emptyDirSync(tempDir);
        });
        afterEach(() => {
            fsExtra.emptyDirSync(tempDir);
        });

        function setupProgram(opts: { rsgVersion?: string; minFirmwareVersion?: string }) {
            const manifestContents = opts.rsgVersion
                ? trim`
                    title=t
                    rsg_version=${opts.rsgVersion}
                `
                : trim`title=t`;
            fsExtra.writeFileSync(`${tempDir}/manifest`, manifestContents);
            program.dispose();
            program = new Program({
                rootDir: tempDir,
                minFirmwareVersion: opts.minFirmwareVersion
            });
        }

        it('flags `eval(...)` under default settings (no manifest rsg_version, default minFirmwareVersion)', () => {
            //default minFirmwareVersion is 15.0.0, so effective rsg_version is 1.2
            setupProgram({});
            program.setFile('source/main.brs', `
                sub main()
                    eval("print 1")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.globalCallableRemoved('eval', 'rsg', '1.2.0', '1.2.0')
            }]);
        });

        it('flags `eval(...)` when manifest declares rsg_version=1.2', () => {
            setupProgram({ rsgVersion: '1.2' });
            program.setFile('source/main.brs', `
                sub main()
                    eval("print 1")
                end sub
            `);
            program.validate();
            const evalDiags = program.getDiagnostics().filter(d => d.code === DiagnosticMessages.globalCallableRemoved('eval', 'rsg', '1.2.0').code
            );
            expect(evalDiags).to.be.lengthOf(1);
        });

        it('flags `eval(...)` when manifest declares rsg_version=1.3', () => {
            setupProgram({ rsgVersion: '1.3' });
            program.setFile('source/main.brs', `
                sub main()
                    eval("print 1")
                end sub
            `);
            program.validate();
            const evalDiags = program.getDiagnostics().filter(d => d.code === DiagnosticMessages.globalCallableRemoved('eval', 'rsg', '1.2.0').code
            );
            expect(evalDiags).to.be.lengthOf(1);
        });

        it('flags `eval(...)` via os axis when manifest declares rsg_version=1.1 on modern firmware', () => {
            //rsg=1.1 explicit on default firmware (15.0) is an invalid manifest entry — rsg=1.1
            //was removed at OS 14.5. The manifest validator separately flags that. With rsg axis
            //silent (1.1 < 1.2), the os.deprecated fallback fires as a secondary nudge.
            setupProgram({ rsgVersion: '1.1' });
            program.setFile('source/main.brs', `
                sub main()
                    eval("print 1")
                end sub
            `);
            program.validate();
            const evalDiags = program.getDiagnostics().filter(d => d.code === DiagnosticMessages.globalCallableDeprecated().code
            );
            expect(evalDiags).to.be.lengthOf(1);
            expect((evalDiags[0] as any).data?.axis).to.equal('os');
        });

        it('does NOT flag `eval(...)` when minFirmwareVersion is set below 9.3.0 and manifest is silent', () => {
            setupProgram({ minFirmwareVersion: '8.0.0' });
            program.setFile('source/main.brs', `
                sub main()
                    eval("print 1")
                end sub
            `);
            program.validate();
            const evalDiags = program.getDiagnostics().filter(d => d.code === DiagnosticMessages.globalCallableRemoved('eval', 'rsg', '1.2.0').code
            );
            expect(evalDiags).to.be.lengthOf(0);
        });

        it('does NOT flag `m.eval(...)` (method call on object)', () => {
            setupProgram({});
            program.setFile('source/main.brs', `
                sub main()
                    m.eval("print 1")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('does NOT flag `alpha.eval(...)` (namespaced call via dotted-get)', () => {
            setupProgram({});
            program.setFile('source/main.brs', `
                sub main()
                    alpha.eval("print 1")
                end sub
            `);
            program.validate();
            const evalDiags = program.getDiagnostics().filter(d => d.code === DiagnosticMessages.globalCallableRemoved('eval', 'rsg', '1.2.0').code
            );
            expect(evalDiags).to.be.lengthOf(0);
        });

        it('flags eval case-insensitively (Eval, EVAL)', () => {
            setupProgram({});
            program.setFile('source/main.brs', `
                sub main()
                    Eval("print 1")
                end sub
            `);
            program.validate();
            const evalDiags = program.getDiagnostics().filter(d => d.code === DiagnosticMessages.globalCallableRemoved('eval', 'rsg', '1.2.0').code
            );
            expect(evalDiags).to.be.lengthOf(1);
        });
    });

    describe('unreferencable builtins', () => {
        const reservedBuiltinCode = DiagnosticMessages.reservedBuiltinUsedAsValue('').code;

        function reservedBuiltinDiagnostics() {
            return program.getDiagnostics().filter(diagnostic => diagnostic.code === reservedBuiltinCode);
        }

        function expectFlagged(names: string[]) {
            expect(
                reservedBuiltinDiagnostics().map(diagnostic => diagnostic.message)
            ).to.eql(
                names.map(name => DiagnosticMessages.reservedBuiltinUsedAsValue(name).message)
            );
        }

        function expectNotFlagged() {
            expect(reservedBuiltinDiagnostics()).to.eql([]);
        }

        it('flags `x = ObjFun` (RHS value read)', () => {
            program.setFile('source/main.brs', `
                sub a()
                    x = ObjFun
                    print x
                end sub
            `);
            program.validate();
            expectFlagged(['ObjFun']);
        });

        it('flags `print type(ObjFun)` (passed as argument)', () => {
            program.setFile('source/main.brs', `
                sub a()
                    print type(ObjFun)
                end sub
            `);
            program.validate();
            expectFlagged(['ObjFun']);
        });

        it('flags `f(ObjFun, 2)` (passed by value)', () => {
            program.setFile('source/main.brs', `
                sub a()
                    f(ObjFun, 2)
                end sub
                sub f(arg1, arg2)
                end sub
            `);
            program.validate();
            expectFlagged(['ObjFun']);
        });

        it('flags `x = type` (RHS value read)', () => {
            program.setFile('source/main.brs', `
                sub a()
                    x = type
                    print x
                end sub
            `);
            program.validate();
            expectFlagged(['type']);
        });

        it('does not flag `ObjFun(m)` (canonical call)', () => {
            program.setFile('source/main.brs', `
                sub a()
                    ObjFun(m, "")
                end sub
            `);
            program.validate();
            expectNotFlagged();
        });

        it('does not flag `type(123)` (canonical call)', () => {
            program.setFile('source/main.brs', `
                sub a()
                    print type(123)
                end sub
            `);
            program.validate();
            expectNotFlagged();
        });

        it('does not flag `m.ObjFun = 1` (property assignment)', () => {
            program.setFile('source/main.brs', `
                sub a()
                    m.ObjFun = 1
                end sub
            `);
            program.validate();
            expectNotFlagged();
        });

        it('does not flag `m.type = 1` (property assignment)', () => {
            program.setFile('source/main.brs', `
                sub a()
                    m.type = 1
                end sub
            `);
            program.validate();
            expectNotFlagged();
        });

        it('does not flag `{ ObjFun: 1 }` (AA literal key)', () => {
            program.setFile('source/main.brs', `
                sub a()
                    aa = { ObjFun: 1 }
                end sub
            `);
            program.validate();
            expectNotFlagged();
        });

        it('does not flag `{ type: 1 }` (AA literal key)', () => {
            program.setFile('source/main.brs', `
                sub a()
                    aa = { type: 1 }
                end sub
            `);
            program.validate();
            expectNotFlagged();
        });

        it('does not flag a BrighterScript `type Name = ...` statement', () => {
            program.setFile('source/main.bs', `
                type MyAlias = string or integer
            `);
            program.validate();
            expectNotFlagged();
        });

        it('case-insensitive match for OBJFUN, ObjFun, objfun', () => {
            program.setFile('source/main.brs', `
                sub a()
                    x = OBJFUN
                    y = objfun
                end sub
            `);
            program.validate();
            expectFlagged(['OBJFUN', 'objfun']);
        });

        //per-builtin coverage for each device-verified entry in UnreferencableBuiltins.
        //each pair: (1) bare value read flags, (2) canonical call form does not flag.

        it('flags `x = Box` (RHS value read)', () => {
            program.setFile('source/main.brs', `sub a()\nx = Box\nend sub`);
            program.validate();
            expectFlagged(['Box']);
        });

        it('does not flag `Box(1)` (canonical call)', () => {
            program.setFile('source/main.brs', `sub a()\nx = Box(1)\nend sub`);
            program.validate();
            expectNotFlagged();
        });

        it('flags `x = CreateObject` (RHS value read)', () => {
            program.setFile('source/main.brs', `sub a()\nx = CreateObject\nend sub`);
            program.validate();
            expectFlagged(['CreateObject']);
        });

        it('does not flag `CreateObject("roSGNode", "Node")` (canonical call)', () => {
            program.setFile('source/main.brs', `sub a()\nx = CreateObject("roSGNode", "Node")\nend sub`);
            program.validate();
            expectNotFlagged();
        });

        it('flags `x = GetGlobalAA` (RHS value read)', () => {
            program.setFile('source/main.brs', `sub a()\nx = GetGlobalAA\nend sub`);
            program.validate();
            expectFlagged(['GetGlobalAA']);
        });

        it('does not flag `GetGlobalAA()` (canonical call)', () => {
            program.setFile('source/main.brs', `sub a()\nx = GetGlobalAA()\nend sub`);
            program.validate();
            expectNotFlagged();
        });

        it('flags `x = GetLastRunCompileError` (RHS value read)', () => {
            program.setFile('source/main.brs', `sub a()\nx = GetLastRunCompileError\nend sub`);
            program.validate();
            expectFlagged(['GetLastRunCompileError']);
        });

        it('does not flag `GetLastRunCompileError()` (canonical call)', () => {
            program.setFile('source/main.brs', `sub a()\nx = GetLastRunCompileError()\nend sub`);
            program.validate();
            expectNotFlagged();
        });

        it('flags `x = GetLastRunRunTimeError` (RHS value read)', () => {
            program.setFile('source/main.brs', `sub a()\nx = GetLastRunRunTimeError\nend sub`);
            program.validate();
            expectFlagged(['GetLastRunRunTimeError']);
        });

        it('does not flag `GetLastRunRunTimeError()` (canonical call)', () => {
            program.setFile('source/main.brs', `sub a()\nx = GetLastRunRunTimeError()\nend sub`);
            program.validate();
            expectNotFlagged();
        });

        it('flags `x = Pos` (RHS value read)', () => {
            program.setFile('source/main.brs', `sub a()\nx = Pos\nend sub`);
            program.validate();
            expectFlagged(['Pos']);
        });

        it('does not flag `Pos(0)` (canonical call)', () => {
            program.setFile('source/main.brs', `sub a()\nx = Pos(0)\nend sub`);
            program.validate();
            expectNotFlagged();
        });

        it('flags `x = Run` (RHS value read)', () => {
            program.setFile('source/main.brs', `sub a()\nx = Run\nend sub`);
            program.validate();
            expectFlagged(['Run']);
        });

        it('does not flag `Run("pkg:/source/foo.brs")` (canonical call)', () => {
            program.setFile('source/main.brs', `sub a()\nx = Run("pkg:/source/foo.brs")\nend sub`);
            program.validate();
            expectNotFlagged();
        });

        it('flags `x = Tab` (RHS value read)', () => {
            program.setFile('source/main.brs', `sub a()\nx = Tab\nend sub`);
            program.validate();
            expectFlagged(['Tab']);
        });

        it('does not flag `Tab(5)` (canonical call)', () => {
            program.setFile('source/main.brs', `sub a()\nx = Tab(5)\nend sub`);
            program.validate();
            expectNotFlagged();
        });

        it('flags `x = eval` (RHS value read)', () => {
            program.setFile('source/main.brs', `sub a()\nx = eval\nend sub`);
            program.validate();
            expectFlagged(['eval']);
        });

        it('does not flag `eval("print 1")` (canonical call)', () => {
            program.setFile('source/main.brs', `sub a()\neval("print 1")\nend sub`);
            program.validate();
            expectNotFlagged();
        });
    });
});
