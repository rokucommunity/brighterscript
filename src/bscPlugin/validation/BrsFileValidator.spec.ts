import { expect } from '../../chai-config.spec';
import type { BrsFile } from '../../files/BrsFile';
import type { AALiteralExpression, DottedGetExpression } from '../../parser/Expression';
import type { AssignmentStatement, ClassStatement, FunctionStatement, NamespaceStatement, PrintStatement } from '../../parser/Statement';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { expectDiagnostics, expectHasDiagnostics, expectTypeToBe, expectZeroDiagnostics } from '../../testHelpers.spec';
import { Program } from '../../Program';
import { isClassStatement, isNamespaceStatement } from '../../astUtils/reflection';
import util from '../../util';
import { WalkMode, createVisitor } from '../../astUtils/visitors';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import { ClassType } from '../../types/ClassType';
import { FloatType } from '../../types/FloatType';
import { IntegerType } from '../../types/IntegerType';
import { InterfaceType } from '../../types/InterfaceType';
import { StringType } from '../../types/StringType';

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

    it('links namespace name dotted get parents', () => {
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

    it('flags namespaces in wrong locations', () => {
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

    describe('typecast statement', () => {
        it('allows being at start of file', () => {
            program.setFile('source/other.bs', `
            `);

            program.setFile('source/main.bs', `
                import "other.bs"
                typecast m as object

                sub noop()
                end sub

            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has diagnostic if not first in file', () => {
            program.setFile('source/main.bs', `
                sub noop()
                end sub

                typecast m as object
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.typecastStatementMustBeDeclaredAtStart().message
            ]);
        });

        it('allows being at start of function ', () => {
            program.setFile('source/main.bs', `
                interface Thing
                    value as integer
                end interface

                sub noop()
                    typecast m as Thing
                    print m.value
                end sub

            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has diagnostic when not at start of function', () => {
            program.setFile('source/main.bs', `
                interface Thing
                    value as integer
                end interface

                sub noop()
                    print m.value
                    typecast m as Thing
                end sub

            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.typecastStatementMustBeDeclaredAtStart().message
            ]);
        });

        it('sets the type of m', () => {
            program.setFile('source/types.bs', `
                interface Thing1
                    value as integer
                end interface

                interface Thing2
                    value as string
                end interface

                interface Thing3
                    value as float
                end interface
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"
                typecast m as Thing1

                sub func1()
                    x = m.value
                    print x
                end sub

                sub func2()
                    typecast m as Thing2
                    x = m.value
                    print x
                end sub

                sub func3()
                    aa = {
                        innerFunc: sub()
                            typecast m as Thing3
                            x = m.value
                            print x
                        end sub
                    }
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const assigns = [] as Array<AssignmentStatement>;

            // find places in AST where "x" is assigned
            file.ast.walk(createVisitor({
                AssignmentStatement: (stmt) => {
                    if (stmt.tokens.name.text.toLowerCase() === 'x') {
                        assigns.push(stmt);
                    }
                }
            }), { walkMode: WalkMode.visitAllRecursive });

            // func1 - uses file level typecast
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing1');
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), IntegerType);

            // func2 - uses func level typecast
            expectTypeToBe(assigns[1].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[1].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing2');
            expectTypeToBe(assigns[1].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), StringType);

            // func3 - uses innerFunc level typecast
            expectTypeToBe(assigns[2].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[2].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing3');
            expectTypeToBe(assigns[2].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), FloatType);
        });

        it('should allow classes to override m typecast', () => {
            program.setFile('source/types.bs', `
                interface Thing1
                    value as integer
                end interface
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"
                typecast m as Thing1

                class TestKlass
                    value as string

                    sub method1()
                        x = m.value
                        print x
                    end sub

                    sub method2()
                        typecast m as Thing1
                        x = m.value
                        print x
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const assigns = [] as Array<AssignmentStatement>;

            // find places in AST where "x" is assigned
            file.ast.walk(createVisitor({
                AssignmentStatement: (stmt) => {
                    if (stmt.tokens.name.text.toLowerCase() === 'x') {
                        assigns.push(stmt);
                    }
                }
            }), { walkMode: WalkMode.visitAllRecursive });


            // method1 - uses class 'm'
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), ClassType);
            expect(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('TestKlass');
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), StringType);

            // method2 - uses func level typecast
            expectTypeToBe(assigns[1].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[1].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing1');
            expectTypeToBe(assigns[1].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), IntegerType);
        });

        it('has diagnostic when used in a class', () => {
            program.setFile('source/main.bs', `
                class TestKlass
                    typecast m as object

                    value as string

                    sub method1()
                        x = m.value
                        print x
                    end sub
                end class
            `);
            program.validate();
            expectHasDiagnostics(program);
        });

        it('is allowed in namespace', () => {
            program.setFile('source/types.bs', `
                interface Thing1
                    value as integer
                end interface
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"

                namespace Alpha.Beta
                    typecast m as Thing1

                    sub method1()
                        x = m.value
                        print x
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            // find places in AST where "x" is assigned
            const assigns = [] as Array<AssignmentStatement>;
            file.ast.walk(createVisitor({
                AssignmentStatement: (stmt) => {
                    if (stmt.tokens.name.text.toLowerCase() === 'x') {
                        assigns.push(stmt);
                    }
                }
            }), { walkMode: WalkMode.visitAllRecursive });


            // method1 - uses Thing1 'm'
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }), InterfaceType);
            expect(assigns[0].getSymbolTable().getSymbolType('m', { flags: SymbolTypeFlag.runtime }).toString()).to.eq('Thing1');
            expectTypeToBe(assigns[0].getSymbolTable().getSymbolType('x', { flags: SymbolTypeFlag.runtime }), IntegerType);
        });
    });
});
