import { expect } from '../../chai-config.spec';
import type { BrsFile } from '../../files/BrsFile';
import type { AALiteralExpression, DottedGetExpression, FunctionExpression } from '../../parser/Expression';
import type { AssignmentStatement, ClassStatement, ForEachStatement, FunctionStatement, NamespaceStatement, PrintStatement } from '../../parser/Statement';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { expectDiagnostics, expectHasDiagnostics, expectTypeToBe, expectZeroDiagnostics, rootDir, tempDir, trim } from '../../testHelpers.spec';
import { Program } from '../../Program';
import { isAssignmentStatement, isClassStatement, isForEachStatement, isFunctionExpression, isFunctionParameterExpression, isFunctionStatement, isNamespaceStatement, isPrintStatement, isReturnStatement } from '../../astUtils/reflection';
import { util, standardizePath as s } from '../../util';
import { WalkMode, createVisitor } from '../../astUtils/visitors';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import { ClassType } from '../../types/ClassType';
import { FloatType } from '../../types/FloatType';
import { IntegerType } from '../../types/IntegerType';
import { InterfaceType } from '../../types/InterfaceType';
import { StringType } from '../../types/StringType';
import { ArrayType } from '../../types/ArrayType';
import { DynamicType } from '../../types/DynamicType';
import { TypedFunctionType } from '../../types/TypedFunctionType';
import { ParseMode } from '../../parser/Parser';
import type { ExtraSymbolData } from '../../interfaces';
import { AssociativeArrayType } from '../../types/AssociativeArrayType';
import { EnumType } from '../../types';
import { TypeStatementType } from '../../types/TypeStatementType';
import * as fsExtra from 'fs-extra';

describe('BrsFileValidator', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
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
            location: { range: util.createRange(2, 16, 2, 27) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('class'),
            location: { range: util.createRange(5, 20, 5, 30) }
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
            location: { range: util.createRange(2, 16, 2, 26) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('enum'),
            location: { range: util.createRange(6, 20, 6, 29) }
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
            location: { range: util.createRange(2, 16, 2, 30) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('function'),
            location: { range: util.createRange(5, 20, 5, 33) }
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
            location: { range: util.createRange(2, 16, 2, 31) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('namespace'),
            location: { range: util.createRange(5, 20, 5, 34) }
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
            location: { range: util.createRange(2, 16, 2, 31) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('interface'),
            location: { range: util.createRange(6, 20, 6, 34) }
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
            location: { range: util.createRange(2, 16, 2, 27) }
        }, {
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('const'),
            location: { range: util.createRange(4, 20, 4, 30) }
        }]);
    });

    describe('function name length', () => {
        it('allows a function name at exactly the max length', () => {
            const name = 'a'.repeat(89);
            program.setFile('source/main.brs', `
                sub ${name}()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('flags a function name that exceeds the max length', () => {
            const name = 'a'.repeat(90);
            program.setFile('source/main.brs', `
                sub ${name}()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.functionNameTooLong(name, 90, 89),
                location: { range: util.createRange(1, 20, 1, 20 + name.length) }
            }]);
        });

        it('flags a namespaced function whose flattened name exceeds the max length', () => {
            const shortName = 'b'.repeat(85);
            program.setFile('source/main.bs', `
                namespace alpha
                    sub ${shortName}()
                    end sub
                end namespace
            `);
            program.validate();
            const flattenedName = `alpha_${shortName}`;
            expectDiagnostics(program, [{
                ...DiagnosticMessages.functionNameTooLong(flattenedName, flattenedName.length, 89),
                location: { range: util.createRange(2, 24, 2, 24 + shortName.length) }
            }]);
        });

        it('allows a class method whose transpiled name is exactly the max length', () => {
            //`__Klass_method_` is 15 chars, so 74 more lands exactly on the 89-char limit
            const methodName = 'c'.repeat(74);
            program.setFile('source/main.bs', `
                class Klass
                    sub ${methodName}()
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('flags a class method whose transpiled name exceeds the max length', () => {
            const methodName = 'c'.repeat(75);
            program.setFile('source/main.bs', `
                class Klass
                    sub ${methodName}()
                    end sub
                end class
            `);
            program.validate();
            const transpiledName = `__Klass_method_${methodName}`;
            expectDiagnostics(program, [{
                ...DiagnosticMessages.functionNameTooLong(transpiledName, transpiledName.length, 89),
                location: { range: util.createRange(2, 24, 2, 24 + methodName.length) }
            }]);
        });

        it('flags a namespaced class method whose transpiled name exceeds the max length', () => {
            const methodName = 'c'.repeat(70);
            program.setFile('source/main.bs', `
                namespace alpha
                    class Klass
                        sub ${methodName}()
                        end sub
                    end class
                end namespace
            `);
            program.validate();
            const transpiledName = `__alpha_Klass_method_${methodName}`;
            expectDiagnostics(program, [{
                ...DiagnosticMessages.functionNameTooLong(transpiledName, transpiledName.length, 89),
                location: { range: util.createRange(3, 28, 3, 28 + methodName.length) }
            }]);
        });
    });

    describe('for each', () => {
        it('handles getting default type of array of AAs with reference types', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', `
                function test()
                    settings = []
                    screensData = [
                        { id: "home", actions: [Actions.TrackUser1, Actions.Next], listMode: ListModes.Avatar },
                        { id: "home", actions: [Actions.TrackUser1, Actions.Next], listMode: ListModes.Small },
                        { id: "test", actions: [Actions.TrackUser2, Actions.Next], listMode: ListModes.Profile },
                        { id: "autoplay", actions: [Actions.TrackUser2, Actions.Next], listMode: ListModes.Large }
                    ]

                    for each screenData in screensData
                        if screenData.id = "test"
                            settings.push(screenData)
                        end if
                    end for
                    return settings
                end function

                enum Actions
                    TrackUser1
                    TrackUser2
                    Next
                end enum

                enum ListModes
                    Avatar
                    Small
                    Profile
                    Large
                end enum
            `);

            program.validate();
            expectZeroDiagnostics(program);
            const forStmt = mainFile.ast.findChild<ForEachStatement>(isForEachStatement);
            const insideFor = forStmt.body.statements[0];
            const screensDataType = insideFor.getSymbolTable().getSymbolType('screensData', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(screensDataType, ArrayType);
            const screenDataType = insideFor.getSymbolTable().getSymbolType('screenData', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(screenDataType, AssociativeArrayType);
        });

        it('handles getting default type of array of reference types', () => {
            const mainFile = program.setFile<BrsFile>('source/main.bs', `
                function test()
                    result = []
                    actions = [Actions.TrackUser1, Actions.Next2]

                    for each action in actions
                        if action = Actions.Next2
                            actions.push(action)
                        end if
                    end for
                    return result
                end function

                enum Actions
                    TrackUser1
                    TrackUser2
                    Next2
                end enum
            `);

            program.validate();
            expectZeroDiagnostics(program);
            const forStmt = mainFile.ast.findChild<ForEachStatement>(isForEachStatement);
            const insideFor = forStmt.body.statements[0];
            const actionsType = insideFor.getSymbolTable().getSymbolType('actions', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(actionsType, ArrayType);
            const actionType = insideFor.getSymbolTable().getSymbolType('action', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(actionType, DynamicType);
        });
    });


    describe('typecast statement', () => {
        it('allows being at start of file', () => {
            program.setFile('source/main.bs', `
                typecast m as object

                sub noop()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has diagnostic if more than one usage per block for the same variable', () => {
            program.setFile('source/main.bs', `
                typecast m as object
                typecast m as integer

                sub noop()
                    typecast m as object
                    typecast m as string
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of block or namespace').message,
                DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of block or namespace').message
            ]);
        });

        it('has diagnostic if typecasting variables other than m outside a block', () => {
            program.setFile('source/main.bs', `
                typecast alpha.beta.notM as object ' error
                typecast alsoNotM as object ' error

                const notM = "also not m"

                sub noop(notM)
                    typecast notM as object ' no error
                end sub

                sub foo()
                    typecast M as object ' no error!
                end sub

                namespace alpha.beta
                    const notM = "namespaced not m"
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.invalidTypecastStatementApplication('alpha.beta.notM', false).message,
                DiagnosticMessages.invalidTypecastStatementApplication('alsoNotM', false).message
            ]);
        });

        it('has diagnostic if typecasting non-variables inside a block', () => {
            program.setFile('source/main.bs', `
                sub noop(notM)
                    typecast alpha.beta.notM as object ' error
                end sub

                namespace alpha.beta
                    const notM = "namespaced not m"
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.invalidTypecastStatementApplication('alpha.beta.notM', true).message
            ]);
        });

        it('has diagnostic if not first in file', () => {
            program.setFile('source/main.bs', `
                sub noop()
                end sub

                typecast m as object
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of block or namespace').message
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

        it('has diagnostic when not at start of block', () => {
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
                DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of block or namespace').message
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

        it('sets the the type of a variable in an if block', () => {
            program.setFile('source/types.bs', `
                function isInt(x as dynamic) as boolean
                    return x <> invalid and GetInterface(x, "ifInt") <> invalid
                end function
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"

                sub addOne(input)
                    if isInt(input)
                        typecast input as integer
                        inside =  input + 1
                        print inside
                    end if

                    outside = input
                    print outside
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const assigns = file.ast.findChildren(isAssignmentStatement);
            // inside IF
            const insideType = assigns[0].getSymbolTable().getSymbolType('inside', { flags: SymbolTypeFlag.runtime });
            const inputType = assigns[0].getSymbolTable().getSymbolType('input', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(inputType, IntegerType);
            expectTypeToBe(insideType, IntegerType);

            // outside IF - should not be affected by typecast
            const outsideType = assigns[1].getSymbolTable().getSymbolType('outside', { flags: SymbolTypeFlag.runtime });
            expectTypeToBe(outsideType, DynamicType);
        });

        it('dissalows typecasting the same variable more than once in the same block', () => {
            program.setFile('source/main.bs', `
                sub addOne(input)
                    if true
                        typecast input as integer
                        typecast input as string
                    end if
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of block or namespace').message
            ]);
        });

        it('disallows typecasting types', () => {
            program.setFile('source/main.bs', `
                sub addOne(input)
                    typecast string as integer
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.invalidTypecastStatementApplication('string', true).message
            ]);
        });
    });


    describe('alias statement', () => {
        it('allows being at start of file', () => {
            program.setFile('source/main.bs', `
                alias x = lcase
                sub noop()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('no diagnostic if more than one usage per block', () => {
            program.setFile('source/main.bs', `
                alias x = lcase
                alias y = Str
                sub noop()
                   print x(y(1))
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has diagnostic if used not at top of file', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    alias x = lcase
                    sub noop()
                        alias y = str
                        print "hello"
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.unexpectedStatementLocation('alias', 'at the top of the file').message,
                DiagnosticMessages.unexpectedStatementLocation('alias', 'at the top of the file').message
            ]);
        });

        it('sets the type of the name', () => {
            program.setFile('source/types.bs', `
                interface Thing1
                    value as string
                end interface
                namespace alpha.beta
                    function piAsStr()
                        return "3.14"
                    end function
                    const eulerAsStr = "2.78"
                end namespace
                function lowercase(text as string) as string
                    return lcase(text)
                end function
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"
                alias t = Thing1
                alias p = alpha.beta.piAsStr
                alias e = alpha.beta.eulerAsStr
                alias l = lowercase
                namespace ns1.ns2
                    function lowercase(x as integer) as integer
                        return x
                    end function
                    sub func1(usedAsType as t)
                        x = usedAsType.value
                        print
                        print l(x)
                        print l(p())
                        print l(e)
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            let func: FunctionExpression;

            // find places in AST where "x" is assigned
            file.ast.walk(createVisitor({
                FunctionStatement: (stmt) => {
                    if (stmt.getName(ParseMode.BrighterScript) === 'ns1.ns2.func1') {
                        func = stmt.func;
                    }
                }
            }), { walkMode: WalkMode.visitAllRecursive });

            const symbolTable = func.getSymbolTable();

            expectTypeToBe(symbolTable.getSymbolType('t', { flags: SymbolTypeFlag.typetime }), InterfaceType);
            const tType = symbolTable.getSymbolType('t', { flags: SymbolTypeFlag.typetime }) as InterfaceType;
            expect(tType.name).to.eq('Thing1');
            expectTypeToBe(symbolTable.getSymbolType('p', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
            expectTypeToBe(symbolTable.getSymbolType('e', { flags: SymbolTypeFlag.runtime }), StringType);
            expectTypeToBe(symbolTable.getSymbolType('l', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        });

        it('has diagnostic when rhs not found', () => {
            program.setFile('source/main.bs', `
                alias x = notThere
                sub noop()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('notThere').message
            ]);
        });

    });

    describe('type statement', () => {
        it('allows being at top of ast', () => {
            program.setFile('source/main.bs', `
                type x = string
                sub noop(input as x)
                    print input
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('no diagnostic if more than one usage per block', () => {
            program.setFile('source/main.bs', `
                type x = string
                type y = integer
                sub noop(input as x) as y
                   return input.len()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has diagnostic if used not at top of file', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    sub noop()
                        type y = string
                        print "hello"
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('type').message
            ]);
        });

        it('sets the type of the name', () => {
            program.setFile('source/types.bs', `
                interface Thing1
                    value as string
                end interface
                namespace alpha.beta
                    enum someEnum
                        up = "up"
                        down = "down"
                    end enum
                end namespace
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                import "types.bs"
                type t = Thing1
                type t2 = alpha.beta.someEnum

                namespace ns1.ns2
                    function getDirection(x as t) as t2
                        if x.value = "go up" then
                            return alpha.beta.someEnum.up
                        else
                            return alpha.beta.someEnum.down
                        end if
                    end function
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            let func: FunctionExpression;

            // find places in AST where "x" is assigned
            file.ast.walk(createVisitor({
                FunctionStatement: (stmt) => {
                    if (stmt.getName(ParseMode.BrighterScript) === 'ns1.ns2.getDirection') {
                        func = stmt.func;
                    }
                }
            }), { walkMode: WalkMode.visitAllRecursive });

            const symbolTable = func.getSymbolTable();

            expectTypeToBe(symbolTable.getSymbolType('t', { flags: SymbolTypeFlag.typetime }), TypeStatementType);
            const tType = symbolTable.getSymbolType('t', { flags: SymbolTypeFlag.typetime }) as TypeStatementType;
            expect(tType.name).to.eq('t');
            expectTypeToBe(tType.wrappedType, InterfaceType);
            expect((tType.wrappedType as InterfaceType).name).to.eq('Thing1');

            expectTypeToBe(symbolTable.getSymbolType('t2', { flags: SymbolTypeFlag.typetime }), TypeStatementType);
            const t2Type = symbolTable.getSymbolType('t2', { flags: SymbolTypeFlag.typetime }) as TypeStatementType;
            expectTypeToBe(t2Type.wrappedType, EnumType);
            expect((t2Type.wrappedType as EnumType).name).to.eq('alpha.beta.someEnum');
        });

        it('has diagnostic when rhs not found', () => {
            program.setFile('source/main.bs', `
                type x = notThere
                sub noop()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('notThere').message
            ]);
        });

    });

    describe('conditional compile', () => {
        it('allows top level definitions inside #if block', () => {
            program.setFile<BrsFile>('source/main.bs', `
                #const debug = true
                #if debug
                function f()
                    return 3.14
                end function
                #end if
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('does not allow top level definitions inside #if block inside a function', () => {
            program.setFile<BrsFile>('source/main.bs', `
                #const debug = true
                function f()
                    #if debug
                    namespace alpha
                    end namespace
                    #end if
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('namespace')
            ]);
        });

        it('shows diagnostic for #error', () => {
            program.setFile<BrsFile>('source/main.bs', `
                #const debug = true
                function f()
                    #if debug
                    #error This is a conditional compile error
                    #end if
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.hashError('This is a conditional compile error')
            ]);
        });

        it('does not show diagnostic for #error when inside false CC block', () => {
            program.setFile<BrsFile>('source/main.bs', `
                #const debug = false
                function f()
                    #if debug
                    #error This is a conditional compile error
                    #end if
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('evaluation', () => {
            let evaluationProgram: Program;
            afterEach(() => {
                evaluationProgram?.dispose();
                fsExtra.removeSync(`${rootDir}/manifest`);
            });

            /**
             * Load a file into a new program and return `code@line` (zero-based) for every diagnostic
             */
            function validate(source: string, options?: { bsConsts?: Record<string, boolean>; minFirmwareVersion?: string; destPath?: string }) {
                evaluationProgram?.dispose();
                fsExtra.removeSync(`${rootDir}/manifest`);
                if (options?.bsConsts) {
                    const bsConstText = Object.entries(options.bsConsts).map(([name, value]) => `${name}=${value}`).join(';');
                    fsExtra.outputFileSync(`${rootDir}/manifest`, `title=test\nbs_const=${bsConstText}\n`);
                }
                evaluationProgram = new Program({
                    rootDir: rootDir,
                    minFirmwareVersion: options?.minFirmwareVersion
                });
                const file = evaluationProgram.setFile<BrsFile>(options?.destPath ?? 'source/main.brs', source);
                evaluationProgram.validate();
                return {
                    file: file,
                    diagnostics: evaluationProgram.getDiagnostics().map(diagnostic => `${diagnostic.code}@${diagnostic.location.range.start.line}`)
                };
            }

            function collectPrintedText(file: BrsFile) {
                const printed: string[] = [];
                file.ast.walk(createVisitor({
                    PrintStatement: (statement) => {
                        printed.push(statement.expressions.map(expression => (expression as any).tokens?.value?.text).join(''));
                    }
                }), { walkMode: WalkMode.visitAllRecursive });
                return printed;
            }

            it('uses a file-level #const when walking the active branch', () => {
                const { diagnostics } = validate(`
                    #const LOGGING = true
                    sub main()
                    #if LOGGING
                        activeVar = 1
                        print activeVar
                    #else
                        inactiveVar = 2
                        print inactiveVar
                    #end if
                    end sub
                `);
                expect(diagnostics).to.eql([]);
            });

            it('lets plugins walk the active branch and not the inactive branch', () => {
                const { file, diagnostics } = validate(`
                    #const LOGGING = true
                    sub main()
                        print "start"
                    #if LOGGING
                        print "active"
                        notAFunctionActive()
                    #else
                        print "inactive"
                        notAFunctionInactive()
                    #end if
                    end sub
                `);
                expect(diagnostics).to.eql(['cannot-find-function@6']);
                expect(collectPrintedText(file)).to.eql(['"start"', '"active"']);
            });

            it('treats #if true as true', () => {
                const { diagnostics } = validate(`
                    #if true
                    #error active-true-error
                    #else
                    #error inactive-else-error
                    #end if
                    sub main()
                    end sub
                `);
                expect(diagnostics).to.eql(['hash-error@2']);
            });

            it('treats #if not true as false', () => {
                const { diagnostics } = validate(`
                    #if not true
                    #error inactive-error
                    #else
                    #error active-error
                    #end if
                    sub main()
                    end sub
                `);
                expect(diagnostics).to.eql(['hash-error@4']);
            });

            it('treats #if false as false and #if not false as true', () => {
                const { diagnostics } = validate(`
                    #if false
                    #error inactive-error
                    #end if
                    #if not false
                    #error active-error
                    #end if
                `);
                expect(diagnostics).to.eql(['hash-error@5']);
            });

            it('validates the active branch of a literal #if inside a function', () => {
                const { file, diagnostics } = validate(`
                    sub main()
                    #if true
                        print "active"
                        notAFunctionActive()
                    #else
                        print "inactive"
                        notAFunctionInactive()
                    #end if
                    end sub
                `);
                expect(diagnostics).to.eql(['cannot-find-function@4']);
                expect(collectPrintedText(file)).to.eql(['"active"']);
            });

            describe('parse diagnostics', () => {
                it('keeps syntax errors in a literal true branch', () => {
                    const { diagnostics } = validate(`
                        sub main()
                        #if true
                            x = = 1
                        #end if
                        end sub
                    `);
                    expect(diagnostics).to.eql(['unexpected-token@3']);
                });

                it('drops syntax errors in the inactive else of an active #if DEBUG', () => {
                    const { diagnostics } = validate(`
                        sub main()
                        #if DEBUG
                            print "active"
                        #else
                            y = = 2
                        #end if
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                });

                it('keeps syntax errors in an active #if not DEBUG', () => {
                    const { diagnostics } = validate(`
                        sub main()
                        #if not DEBUG
                            z = = 3
                        #end if
                        end sub
                    `, { bsConsts: { DEBUG: false } });
                    expect(diagnostics).to.eql(['unexpected-token@3']);
                });

                it('keeps syntax errors in a branch enabled by a file-level #const', () => {
                    const { diagnostics } = validate(`
                        #const LOGGING = true
                        sub main()
                        #if LOGGING
                            w = = 4
                        #end if
                        end sub
                    `);
                    expect(diagnostics).to.eql(['unexpected-token@4']);
                });

                it('drops syntax errors in an inactive #if not DEBUG', () => {
                    const { diagnostics } = validate(`
                        sub main()
                        #if not DEBUG
                            v = = 5
                        #end if
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                });

                it('drops syntax errors in the inactive tail of an #else if chain', () => {
                    const { diagnostics } = validate(`
                        sub main()
                        #if true
                            print "active"
                        #else if DEBUG
                            a = = 1
                        #else
                            b = = 2
                        #end if
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                });

                it('drops syntax errors in an inactive #if false / #else if DEBUG / #else chain', () => {
                    const { diagnostics } = validate(`
                        sub main()
                        #if false
                            a = = 1
                        #else if DEBUG
                            print "active"
                        #else
                            b = = 2
                        #end if
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                });

                it('keeps syntax errors in the final #else when every earlier condition is false', () => {
                    const { diagnostics } = validate(`
                        sub main()
                        #if false
                            a = = 1
                        #else if DEBUG
                            print "inactive"
                        #else
                            b = = 2
                        #end if
                        end sub
                    `, { bsConsts: { DEBUG: false } });
                    expect(diagnostics).to.eql(['unexpected-token@7']);
                });
            });

            describe('duplicate #const', () => {
                it('flags an active #const that redeclares an active #const', () => {
                    const { diagnostics } = validate(`
                        #const A = true
                        #const A = false
                        sub main()
                        end sub
                    `);
                    expect(diagnostics).to.eql(['duplicate-const-declaration@2']);
                });

                it('flags a #const that redeclares a bs_const', () => {
                    const { diagnostics } = validate(`
                        #const DEBUG = false
                        sub main()
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql(['duplicate-const-declaration@1']);
                });

                it('allows a duplicate #const inside an inactive branch', () => {
                    const { diagnostics } = validate(`
                        #const A = true
                        #if false
                        #const A = false
                        #end if
                        sub main()
                        end sub
                    `);
                    expect(diagnostics).to.eql([]);
                });

                it('reports only the invalid value when a #const alias reuses a declared name', () => {
                    const { diagnostics } = validate(`
                        #const A = true
                        #const A = B
                    `);
                    expect(diagnostics).to.eql(['invalid-hash-const-value@2']);
                });

                it('reports only the invalid value when an invalid #const reuses a bs_const name', () => {
                    const { diagnostics } = validate(`
                        #const DEBUG = NOPE
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql(['invalid-hash-const-value@1']);
                });

                it('does not apply a #const declared in an inactive branch', () => {
                    const { diagnostics } = validate(`
                        #if false
                        #const A = true
                        #end if
                        #if A
                        #error inactive-error
                        #end if
                        #const A = true
                    `, { minFirmwareVersion: '16.0.0' });
                    expect(diagnostics).to.eql([]);
                });

                it('applies a #const declared in the active branch in source order', () => {
                    const { diagnostics } = validate(`
                        #const DEBUG = false
                        #if DEBUG
                        #const LOGGING = true
                        #else
                        #const LOGGING = false
                        #end if
                        #if LOGGING
                        #error logging-on
                        #end if
                    `);
                    expect(diagnostics).to.eql([]);
                });
            });

            describe('undeclared #const', () => {
                const source = `
                    sub main()
                    #if NOPE
                        print "a"
                    #end if
                    #if LATER
                        print "b"
                    #end if
                    #if INACTIVEONLY
                        print "c"
                    #end if
                    end sub
                    #const LATER = true
                    #if false
                    #const INACTIVEONLY = true
                    #end if
                `;

                it('reports undeclared constants before firmware 16', () => {
                    const { diagnostics } = validate(source, { minFirmwareVersion: '15.3.0' });
                    expect(diagnostics).to.eql([
                        'hash-const-does-not-exist@2',
                        'hash-const-does-not-exist@5',
                        'hash-const-does-not-exist@8'
                    ]);
                });

                it('reports undeclared constants with the default firmware', () => {
                    const { diagnostics } = validate(source);
                    expect(diagnostics).to.eql([
                        'hash-const-does-not-exist@2',
                        'hash-const-does-not-exist@5',
                        'hash-const-does-not-exist@8'
                    ]);
                });

                it('evaluates undeclared constants as false on firmware 16 and up', () => {
                    const { diagnostics } = validate(source, { minFirmwareVersion: '16.0.0' });
                    expect(diagnostics).to.eql([]);
                });

                it('reports an undeclared constant in an evaluated #else if before firmware 16', () => {
                    const { diagnostics } = validate(`
                        #if false
                        #else if NOPE
                        #end if
                    `, { minFirmwareVersion: '15.3.0' });
                    expect(diagnostics).to.eql(['hash-const-does-not-exist@2']);
                });

                it('does not report an undeclared constant in an #else if that is never reached', () => {
                    const { diagnostics } = validate(`
                        #if true
                        #else if NOPE
                        #end if
                    `, { minFirmwareVersion: '15.3.0' });
                    expect(diagnostics).to.eql([]);
                });

                it('does not report an undeclared constant inside an inactive branch', () => {
                    const { diagnostics } = validate(`
                        #if false
                        #if NOPE
                        #end if
                        #end if
                    `, { minFirmwareVersion: '15.3.0' });
                    expect(diagnostics).to.eql([]);
                });
            });

            describe('duplicate functions', () => {
                it('allows the same function in mutually exclusive branches', () => {
                    const { diagnostics } = validate(`
                        #if DEBUG
                        sub logit()
                            print "active"
                        end sub
                        #else
                        sub logit()
                            print "inactive"
                        end sub
                        #end if
                        sub main()
                            logit()
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                });

                it('allows the same function in branches chosen by a file-level #const', () => {
                    const { diagnostics } = validate(`
                        #const DEBUG = false
                        #if DEBUG
                        #const LOGGING = true
                        #else
                        #const LOGGING = false
                        #end if
                        #if LOGGING
                        sub logit()
                            print "log-on"
                        end sub
                        #else
                        sub logit()
                            print "log-off"
                        end sub
                        #end if
                        sub Main()
                            logit()
                        end sub
                    `);
                    expect(diagnostics).to.eql([]);
                });

                it('still reports a function duplicated within the active branch', () => {
                    const { diagnostics } = validate(`
                        #if true
                        sub logit()
                        end sub
                        sub logit()
                        end sub
                        #end if
                    `);
                    expect(diagnostics).to.eql(['duplicate-function@2', 'duplicate-function@4']);
                });
            });

            describe('invalid #const value', () => {
                it('rejects an alias of a declared constant at every firmware level', () => {
                    for (const minFirmwareVersion of ['15.3.0', '16.0.0']) {
                        const { diagnostics } = validate(`
                            #const A = true
                            #const B = A
                        `, { minFirmwareVersion: minFirmwareVersion });
                        expect(diagnostics, minFirmwareVersion).to.eql(['invalid-hash-const-value@2']);
                    }
                });

                it('rejects an alias of an undeclared name', () => {
                    const { diagnostics } = validate(`
                        #const B = NOPE
                    `, { minFirmwareVersion: '16.0.0' });
                    expect(diagnostics).to.eql(['invalid-hash-const-value@1']);
                });

                it('treats a later #if on the alias as undeclared before firmware 16', () => {
                    const { diagnostics } = validate(`
                        #const A = true
                        #const B = A
                        #if B
                        #error alias-resolved
                        #end if
                    `, { minFirmwareVersion: '15.3.0' });
                    expect(diagnostics).to.eql(['invalid-hash-const-value@2', 'hash-const-does-not-exist@3']);
                });

                it('treats a later #if on the alias as false on firmware 16 and up', () => {
                    const { diagnostics } = validate(`
                        #const A = true
                        #const B = A
                        #if B
                        #error alias-resolved
                        #end if
                    `, { minFirmwareVersion: '16.0.0' });
                    expect(diagnostics).to.eql(['invalid-hash-const-value@2']);
                });

                it('does not report an alias inside an inactive branch', () => {
                    const { diagnostics } = validate(`
                        #const A = true
                        #if false
                        #const B = A
                        #end if
                    `);
                    expect(diagnostics).to.eql([]);
                });
            });

            describe('declarations in inactive branches', () => {
                async function transpile(source: string, options?: { bsConsts?: Record<string, boolean> }) {
                    const { file, diagnostics } = validate(source, { ...options, destPath: 'source/main.bs' });
                    const { code } = await evaluationProgram.getTranspiledFileContents(file.srcPath);
                    return { code: code, diagnostics: diagnostics };
                }

                it('uses the active const when the inactive #else declares the same name', async () => {
                    const { code, diagnostics } = await transpile(`
                        #if DEBUG
                        const LEVEL = 1
                        #else
                        const LEVEL = 2
                        #end if
                        sub main()
                            print LEVEL
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('print 1');
                    expect(code).not.to.include('print 2');
                });

                it('uses the active enum member when the inactive #else declares the same enum', async () => {
                    const { code, diagnostics } = await transpile(`
                        #if DEBUG
                        enum Color
                            red = "active-red"
                        end enum
                        #else
                        enum Color
                            red = "inactive-red"
                        end enum
                        #end if
                        sub main()
                            print Color.red
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('active-red');
                    expect(code).not.to.include('inactive-red');
                });

                it('uses the active class and interface without duplicate-name diagnostics', () => {
                    const { file, diagnostics } = validate(`
                        #if DEBUG
                        class Widget
                            activeField = 1
                        end class
                        interface Shape
                            activeMember as integer
                        end interface
                        #else
                        class Widget
                            inactiveField = 2
                        end class
                        interface Shape
                            inactiveMember as integer
                        end interface
                        #end if
                        sub main()
                            w = new Widget()
                            print w.activeField
                        end sub
                        function describeShape(item as Shape) as integer
                            return item.activeMember
                        end function
                    `, { bsConsts: { DEBUG: true }, destPath: 'source/main.bs' });
                    expect(diagnostics).to.eql([]);
                    const scope = evaluationProgram.getScopesForFile(file)[0];
                    const widget = scope.getClassMap().get('widget').item;
                    expect(widget.fields.map(field => field.tokens.name.text)).to.eql(['activeField']);
                    const shape = scope.getInterfaceMap().get('shape').item;
                    expect(shape.fields.map(field => field.tokens.name.text)).to.eql(['activeMember']);
                });

                it('inlines an inactive enum and const used in the inactive branch that declares them', async () => {
                    const { code, diagnostics } = await transpile(`
                        #if not DEBUG
                        enum Color
                            red = "r"
                        end enum
                        const LEVEL = 3
                        sub debugOnly()
                            print Color.red
                            print LEVEL
                        end sub
                        #end if
                        sub main()
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('print "r"');
                    expect(code).to.include('print 3');
                    expect(code).not.to.include('Color.red');
                    expect(code).not.to.include('print LEVEL');
                });

                it('inlines an active enum and const used in an inactive branch', async () => {
                    const { code, diagnostics } = await transpile(`
                        enum Color
                            red = "r"
                        end enum
                        const LEVEL = 3
                        sub main()
                        #if not DEBUG
                            print Color.red
                            print LEVEL
                        #end if
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('print "r"');
                    expect(code).to.include('print 3');
                });

                it('inlines a namespaced inactive enum and const used in an inactive branch', async () => {
                    const { code, diagnostics } = await transpile(`
                        namespace alpha
                        #if not DEBUG
                            enum Color
                                red = "r"
                            end enum
                            const LEVEL = 3
                            sub inside()
                                print Color.red
                                print LEVEL
                            end sub
                        #end if
                        end namespace
                        sub main()
                        #if not DEBUG
                            print alpha.Color.red
                            print alpha.LEVEL
                        #end if
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('print "r"');
                    expect(code).to.include('print 3');
                    expect(code).not.to.include('alpha_Color_red');
                    expect(code).not.to.include('alpha_LEVEL');
                });

                it('links an inactive class to its inactive parent when transpiling', async () => {
                    const { code, diagnostics } = await transpile(`
                        #if not DEBUG
                        class Parent
                            sub new()
                            end sub
                        end class
                        class Child extends Parent
                            sub new()
                                super()
                            end sub
                        end class
                        #end if
                        sub main()
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('instance = __Parent_builder()');
                    expect(code).to.include('instance.super0_new = instance.new');
                    expect(code).to.include('m.super0_new()');
                });

                it('qualifies an inactive class instantiated by a namespace-relative name', async () => {
                    const { code, diagnostics } = await transpile(`
                        namespace alpha
                        #if not DEBUG
                            class Widget
                            end class
                            sub make()
                                widget = new Widget()
                            end sub
                        #end if
                        end namespace
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('widget = alpha_Widget()');
                });

                it('does not capture an inactive enum or const as a ternary closure parameter', async () => {
                    const { code, diagnostics } = await transpile(`
                        #if not DEBUG
                        enum Color
                            red = "r"
                        end enum
                        const LEVEL = 3
                        sub debugOnly(flag)
                            print {k: flag ? Color.red : LEVEL}
                        end sub
                        #end if
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('(function(__bsCondition)');
                    expect(code).to.include('return "r"');
                    expect(code).to.include('return 3');
                });

                it('resolves a namespace-relative name to the active global declaration over an inactive namespaced one', async () => {
                    const { code, diagnostics } = await transpile(`
                        class Foo
                        end class
                        enum Color
                            red = "active-global"
                        end enum
                        const LEVEL = 1
                        namespace NS
                            sub main()
                                f = new Foo()
                                print Color.red
                                print LEVEL
                            end sub
                        end namespace
                        #if false
                        namespace NS
                            class Foo
                            end class
                            enum Color
                                red = "inactive-ns"
                            end enum
                            const LEVEL = 2
                        end namespace
                        #end if
                    `);
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('f = Foo()');
                    expect(code).not.to.include('f = NS_Foo()');
                    expect(code).to.include('print "active-global"');
                    expect(code).not.to.include('inactive-ns');
                    expect(code).to.include('print 1');
                });

                it('keeps resolving to the inactive namespaced declaration when no active global one exists', async () => {
                    const { code } = await transpile(`
                        #if false
                        namespace NS
                            enum Color
                                red = "inactive-ns"
                            end enum
                            sub inside()
                                print Color.red
                            end sub
                        end namespace
                        #end if
                        sub main()
                        end sub
                    `);
                    expect(code).to.include('print "inactive-ns"');
                });

                it('does not report a local variable shadowed by an inactive class', () => {
                    const { diagnostics } = validate(`
                        #if false
                        class Foo
                        end class
                        #end if
                        sub main()
                            foo = 1
                            print foo
                        end sub
                    `, { destPath: 'source/main.bs' });
                    expect(diagnostics).to.eql([]);
                });

                it('still reports a local variable shadowed by an active class', () => {
                    const { diagnostics } = validate(`
                        class Foo
                        end class
                        sub main()
                            foo = 1
                            print foo
                        end sub
                    `, { destPath: 'source/main.bs' });
                    expect(diagnostics).to.have.lengthOf(1);
                });

                it('inlines the active enum in both branches when both branches declare it', async () => {
                    const { code, diagnostics } = await transpile(`
                        #if DEBUG
                        enum Color
                            red = "active-red"
                        end enum
                        #else
                        enum Color
                            red = "inactive-red"
                        end enum
                        #end if
                        sub main()
                        #if DEBUG
                            print Color.red
                        #else
                            print Color.red
                        #end if
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code.match(/print "active-red"/g)).to.have.lengthOf(2);
                    expect(code).not.to.include('inactive-red');
                });

                it('inlines the active const in both branches when both branches declare it', async () => {
                    const { code, diagnostics } = await transpile(`
                        #if DEBUG
                        const LEVEL = 1
                        #else
                        const LEVEL = 2
                        #end if
                        sub main()
                        #if DEBUG
                            print LEVEL
                        #else
                            print LEVEL
                        #end if
                        end sub
                    `, { bsConsts: { DEBUG: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code.match(/print 1/g)).to.have.lengthOf(2);
                    expect(code).not.to.include('print 2');
                });

                it('does not report circular consts declared in an inactive branch', () => {
                    const { diagnostics } = validate(`
                        #if not DEBUG
                        const A = B
                        const B = A
                        #end if
                    `, { bsConsts: { DEBUG: true }, destPath: 'source/main.bs' });
                    expect(diagnostics).to.eql([]);
                });

                it('picks the declaration using a file-level #const', async () => {
                    const { code, diagnostics } = await transpile(`
                        #const LOGGING = false
                        #if LOGGING
                        const LEVEL = 1
                        #else
                        const LEVEL = 2
                        #end if
                        sub main()
                            print LEVEL
                        end sub
                    `);
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('print 2');
                    expect(code).not.to.include('print 1');
                });

                it('picks the declaration from an #else if chain', async () => {
                    const { code, diagnostics } = await transpile(`
                        #if A
                        const LEVEL = 1
                        #else if B
                        const LEVEL = 2
                        #else
                        const LEVEL = 3
                        #end if
                        sub main()
                            print LEVEL
                        end sub
                    `, { bsConsts: { A: false, B: true } });
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('print 2');
                    expect(code).not.to.include('print 1');
                    expect(code).not.to.include('print 3');
                });

                it('picks the final #else declaration when every earlier condition is false', async () => {
                    const { code, diagnostics } = await transpile(`
                        #if A
                        const LEVEL = 1
                        #else if B
                        const LEVEL = 2
                        #else
                        const LEVEL = 3
                        #end if
                        sub main()
                            print LEVEL
                        end sub
                    `, { bsConsts: { A: false, B: false } });
                    expect(diagnostics).to.eql([]);
                    expect(code).to.include('print 3');
                });
            });

            describe('declaration location', () => {
                const chainBranchCases: Array<{ description: string; bsConsts: Record<string, boolean> }> = [
                    { description: 'the #if branch is active', bsConsts: { A: true, B: false } },
                    { description: 'the #else if branch is active', bsConsts: { A: false, B: true } },
                    { description: 'the #else branch is active', bsConsts: { A: false, B: false } }
                ];
                for (const chainBranchCase of chainBranchCases) {
                    it(`allows a function in every branch of a top-level #else if chain when ${chainBranchCase.description}`, () => {
                        const { diagnostics } = validate(`
                            #if A
                            sub one()
                            end sub
                            #else if B
                            sub two()
                            end sub
                            #else
                            sub three()
                            end sub
                            #end if
                        `, { bsConsts: chainBranchCase.bsConsts });
                        expect(diagnostics).to.eql([]);
                    });
                }

                it('allows a function in a nested #if at the top level', () => {
                    const { diagnostics } = validate(`
                        #if true
                        #if true
                        sub inner()
                        end sub
                        #end if
                        #end if
                    `);
                    expect(diagnostics).to.eql([]);
                });

                it('allows a function in the #else of a nested #if at the top level', () => {
                    const { diagnostics } = validate(`
                        #if true
                        #if false
                        #else
                        sub inner()
                        end sub
                        #end if
                        #end if
                    `);
                    expect(diagnostics).to.eql([]);
                });

                it('allows a function in a nested #if inside a namespace', () => {
                    const { diagnostics } = validate(`
                        namespace alpha
                            #if true
                            #if true
                            sub inner()
                            end sub
                            #end if
                            #end if
                        end namespace
                    `, { destPath: 'source/main.bs' });
                    expect(diagnostics).to.eql([]);
                });

                it('still rejects a namespace in a nested #if inside a function', () => {
                    const { diagnostics } = validate(`
                        function f()
                        #if true
                        #if true
                            namespace alpha
                            end namespace
                        #end if
                        #end if
                        end function
                    `, { destPath: 'source/main.bs' });
                    expect(diagnostics).to.eql(['invalid-declaration-location@4']);
                });

                it('still rejects a namespace inside an #else if chain within a function', () => {
                    const { diagnostics } = validate(`
                        function f()
                        #if A
                        #else if B
                            namespace alpha
                            end namespace
                        #end if
                        end function
                    `, { bsConsts: { A: false, B: true }, destPath: 'source/main.bs' });
                    expect(diagnostics).to.eql(['invalid-declaration-location@4']);
                });
            });
        });
    });

    describe('types', () => {
        it('sets assignments of invalid as dynamic', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub test()
                    channel = invalid
                    if true
                        channel = {
                            height: 123
                        }
                    end if

                    height = 0
                    if channel <> invalid then
                        height += channel.height
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const func = file.ast.statements[0].findChild<FunctionExpression>(isFunctionExpression, { walkMode: WalkMode.visitAllRecursive });
            const table = func.body.getSymbolTable();
            const data = {} as ExtraSymbolData;
            const channelType = table.getSymbolType('channel', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(channelType, DynamicType);
        });

        it('sets default arg of invalid as dynamic', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub test(channel = invalid)
                    if true
                        channel = {
                            height: 123
                        }
                    end if

                    height = 0
                    if channel <> invalid then
                        height += channel.height
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const func = file.ast.statements[0].findChild<FunctionExpression>(isFunctionExpression, { walkMode: WalkMode.visitAllRecursive });
            const table = func.body.getSymbolTable();
            const data = {} as ExtraSymbolData;
            const channelType = table.getSymbolType('channel', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(channelType, DynamicType);
        });
    });

    describe('instances of types', () => {
        it('sets assigned variables as instances', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
            sub makeKlass()
                x = new Klass()
            end sub

            class Klass
            end class
        `);
            program.validate();
            expectZeroDiagnostics(program);
            const func = file.ast.statements[0].findChild<FunctionExpression>(isFunctionExpression, { walkMode: WalkMode.visitAllRecursive });
            const table = func.body.getSymbolTable();
            const data = {} as ExtraSymbolData;
            const xType = table.getSymbolType('x', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(xType, ClassType);
            expect(data.isInstance).to.be.true;
            expect(table.isSymbolTypeInstance('x')).to.be.true;
        });

        it('sets params as instances', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
            sub makeKlass(x as Klass, n = x.name)
            end sub

            class Klass
                name as string
            end class
        `);
            program.validate();
            expectZeroDiagnostics(program);
            const func = file.ast.statements[0].findChild<FunctionExpression>(isFunctionExpression, { walkMode: WalkMode.visitAllRecursive });
            const table = func.getSymbolTable();
            const data = {} as ExtraSymbolData;
            const xType = table.getSymbolType('x', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(xType, ClassType);
            expect(data.isInstance).to.be.true;
            expect(table.isSymbolTypeInstance('x')).to.be.true;
            const nType = table.getSymbolType('n', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(nType, StringType);
            expect(data.isInstance).to.be.true;
            expect(table.isSymbolTypeInstance('n')).to.be.true;
        });

        it('allows super as instance', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
            class SuperKlass
                name as string
                sub new(name as string)
                    m.name = name
                end sub
            end class

            class Klass extends SuperKlass
                sub new()
                    super("hello")
                end sub

                function getName()
                    return super.name
                end function
            end class
        `);
            program.validate();
            expectZeroDiagnostics(program);
            const klass = file.ast.statements[1] as ClassStatement;
            const newTable = klass.methods[0].func.body.getSymbolTable();
            let data = {} as ExtraSymbolData;
            const newSuperType = newTable.getSymbolType('super', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(newSuperType, ClassType);
            expect(data.isInstance).to.be.true;

            const getNameTable = klass.methods[0].func.body.getSymbolTable();
            data = {} as ExtraSymbolData;
            const getNameSuperType = getNameTable.getSymbolType('super', { flags: SymbolTypeFlag.runtime, data: data });
            expectTypeToBe(getNameSuperType, ClassType);
            expect(data.isInstance).to.be.true;
        });
    });

    describe('types in comments', () => {

        describe('@param', () => {
            it('uses @param type in brs file', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param {string} name
                    function sayHello(name)
                        print "Hello " + name
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                let data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    StringType
                );
                data = {};
                const printSymbolTable = file.ast.findChild(isPrintStatement).getSymbolTable();
                expectTypeToBe(
                    printSymbolTable.getSymbolType('name', {
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    StringType
                );
                expect(data.isFromDocComment).to.be.true;
            });

            it('handles no type in @param tag', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param  name
                    function sayHello(name)
                        print "Hello " + name
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                let data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    DynamicType
                );
                data = {};
                const printSymbolTable = file.ast.findChild(isPrintStatement).getSymbolTable();
                expectTypeToBe(
                    printSymbolTable.getSymbolType('name', {
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    DynamicType
                );
            });

            it('uses @param type in brs file that can refer to a custom type', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param {Klass} myClass
                    function sayHello(myClass)
                        print "Hello " + myClass.name
                    end function
                `);
                program.setFile<BrsFile>('source/klass.bs', `
                    class Klass
                        name as string
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const funcParamExpr = file.ast.findChild(isFunctionParameterExpression);
                expectTypeToBe(
                    funcParamExpr.getType({
                        flags: SymbolTypeFlag.typetime, data: data
                    }),
                    ClassType
                );
                const myClassType = file.ast.findChild(isPrintStatement).getSymbolTable().getSymbolType('myClass', {
                    flags: SymbolTypeFlag.runtime, data: data
                });
                expectTypeToBe(myClassType, ClassType);
                expectTypeToBe(myClassType.getMemberType('name', { flags: SymbolTypeFlag.runtime }), StringType);
                expect(data.isFromDocComment).to.be.true;
            });

            it('uses @param type in brs file that can refer to a built in type', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param {roDeviceInfo} info
                    function sayHello(info)
                        print "Hello " + info.getModel()
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.typetime, data: data
                    }),
                    InterfaceType
                );
                const infoType = file.ast.findChild(isPrintStatement).getSymbolTable().getSymbolType('info', {
                    flags: SymbolTypeFlag.runtime, data: data
                });
                expectTypeToBe(infoType, InterfaceType);
                expectTypeToBe(infoType.getMemberType('getModel', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
                expect(data.isFromDocComment).to.be.true;
            });

            it('allows jsdoc comment style /** prefix', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' /**
                    ' * @param {string} info
                    ' */
                    function sayHello(info)
                        print "Hello " + info
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    StringType
                );
                const infoType = file.ast.findChild(isPrintStatement).getSymbolTable().getSymbolType('info', {
                    flags: SymbolTypeFlag.runtime, data: data
                });
                expectTypeToBe(infoType, StringType);
                expect(data.isFromDocComment).to.be.true;
            });

            it('ignores types it cannot find', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param {TypeNotThere} info
                    function sayHello(info)
                        print "Hello " + info.prop
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('TypeNotThere').message
                ]);
                const data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    DynamicType
                );
                const infoType = file.ast.findChild(isPrintStatement).getSymbolTable().getSymbolType('info', {
                    flags: SymbolTypeFlag.runtime, data: data
                });
                expectTypeToBe(infoType, DynamicType);
                expect(data.isFromDocComment).to.be.true;
            });

            it('allows built-in type in @param in Brightscript mode', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @param {roAssociativeArray} thing
                    function sayHello(thing)
                        print "Hello " + thing.name
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                let data = {} as ExtraSymbolData;
                expectTypeToBe(
                    file.ast.findChild(isFunctionParameterExpression).getType({
                        flags: SymbolTypeFlag.runtime, data: data
                    }),
                    InterfaceType
                );
                data = {};
                const printSymbolTable = file.ast.findChild(isPrintStatement).getSymbolTable();
                const thingType = printSymbolTable.getSymbolType('thing', {
                    flags: SymbolTypeFlag.runtime, data: data
                });
                expectTypeToBe(thingType, InterfaceType);
                expect(thingType.toString()).to.eql('roAssociativeArray');
                expect(data.isFromDocComment).to.be.true;
            });
        });

        describe('@return', () => {
            it('uses @return type in brs file', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @return {string}
                    function getPie()
                        return "pumpkin"
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const funcType = funcStmt.getType({ flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(funcType, TypedFunctionType);
                const returnType = (funcType as TypedFunctionType).returnType;
                expectTypeToBe(returnType, StringType);
            });

            it('allows unknown type when using @return tag', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @return {TypeNotThere}
                    function getPie()
                        return "pumpkin"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('TypeNotThere').message
                ]);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const funcType = funcStmt.getType({ flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(funcType, TypedFunctionType);
                const returnType = (funcType as TypedFunctionType).returnType;
                expectTypeToBe(returnType, DynamicType);
            });

            it('validates return statements against @return tag with valid type', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @return {integer}
                    function getPie()
                        return "pumpkin"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.returnTypeMismatch('string', 'integer').message
                ]);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const funcType = funcStmt.getType({ flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(funcType, TypedFunctionType);
                const returnType = (funcType as TypedFunctionType).returnType;
                expectTypeToBe(returnType, IntegerType);
            });

            it('checks return statements against @return tag with valid custom type', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    ' @return {alpha.Klass}
                    function getPie()
                        return alpha_Klass()
                    end function
                `);
                program.setFile<BrsFile>('source/klass.bs', `
                    namespace alpha
                        class Klass
                            name as string
                        end class
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const funcType = funcStmt.getType({ flags: SymbolTypeFlag.typetime, data: data });
                expectTypeToBe(funcType, TypedFunctionType);
                const returnType = (funcType as TypedFunctionType).returnType;
                expectTypeToBe(returnType, ClassType);
            });

            it('validates return statements against @return tag with valid custom type', () => {
                program.setFile<BrsFile>('source/main.brs', `
                    ' @return {alpha.Klass}
                    function getPie()
                        return "foo"
                    end function
                `);
                program.setFile<BrsFile>('source/klass.bs', `
                    namespace alpha
                        class Klass
                            name as string
                        end class
                    end namespace
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.returnTypeMismatch('string', 'alpha.Klass').message
                ]);
            });
        });

        describe('@type', () => {
            it('uses @type type in brs file', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    function getPie() as string
                        ' @type {string}
                        pieType = getFruit()
                        return pieType
                    end function

                    function getFruit()
                        return "apple"
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const returnStmt = funcStmt.findChild(isReturnStatement);
                const varType = returnStmt.getSymbolTable().getSymbolType('pieType', { flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(varType, StringType);
            });

            it('allows unknown type when using @type tag', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `

                    function getValue()
                        ' @type {unknown}
                        something = {}
                        return something
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('unknown').message
                ]);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const funcType = funcStmt.getType({ flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(funcType, TypedFunctionType);
                const returnType = (funcType as TypedFunctionType).returnType;
                expectTypeToBe(returnType, DynamicType);
            });

            it('treats variable as type given in @type', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    function getModelName()
                        ' @type {roDeviceInfo}
                        info = getData()
                        return info.getModel()
                    end function

                    function getData()
                        return {}
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const assignStmt = file.ast.findChild(isAssignmentStatement);
                const infoType = assignStmt.getSymbolTable().getSymbolType('info', { flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(infoType, InterfaceType);
                expect(infoType.toString()).to.eq('roDeviceInfo');
                expect(data.isFromDocComment).to.be.true;
            });

        });

        // Skipped until we can figure out how to handle @var tags
        describe.skip('@var', () => {
            it('uses @var type in brs file to define types of variables', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    function getPie() as string
                        ' @var {string} someDate
                        if m.top.isTrue
                            someDate = getDate()
                        else
                            someDate = m.date2
                        end if

                        if m.someProp
                            someDate = m.someProp.date
                        end if

                        return someDate
                    end function

                    function getDate()
                        return "Dec 25"
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const data = {} as ExtraSymbolData;
                const funcStmt = file.ast.findChild(isFunctionStatement);
                const returnStmt = funcStmt.findChild(isReturnStatement);
                const varType = returnStmt.getSymbolTable().getSymbolType('someDate', { flags: SymbolTypeFlag.runtime, data: data });
                expectTypeToBe(varType, StringType);
            });
        });
    });

    describe('try/catch', () => {
        it('allows omitting the exception variable in standard brightscript mode', () => {
            program.setFile('source/main.brs', `
                sub new()
                    try
                        print "hello"
                    catch
                        print "error"
                    end try
                end sub
            `);
            expectZeroDiagnostics(program);
        });

        it('shows diagnostic when omitting the exception variable in standard brightscript mode', () => {
            program.setFile('source/main.brs', `
                sub new()
                    try
                        print "hello"
                    catch
                        print "error"
                    end try
                end sub
            `);
            expectDiagnostics(program, []);
        });

        it('shows diagnostics when using  when omitting the exception variable in standard brightscript mode', () => {
            program.setFile('source/main.brs', `
                sub new()
                    try
                        print "hello"
                    catch
                        print "error"
                    end try
                end sub
            `);
            expectDiagnostics(program, []);
        });
    });

    describe('function return values', () => {
        it('catches sub with return value', () => {
            program.setFile('source/main.brs', `
                sub test()
                    return true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                    location: util.createLocation(2, 20, 2, 31, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})
            ]);
        });

        it('catches sub as void with return value', () => {
            program.setFile('source/main.brs', `
                sub test() as void
                    return true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                    location: util.createLocation(2, 20, 2, 31, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})
            ]);
        });

        it('catches function as void with return value', () => {
            program.setFile('source/main.brs', `
                function test() as void
                    return true
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('function'),
                    location: util.createLocation(2, 20, 2, 31, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})
            ]);
        });

        it('catches sub as <type> without return value', () => {
            program.setFile('source/main.brs', `
                sub test() as integer
                    return
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.nonVoidFunctionMustReturnValue('sub'),
                    location: util.createLocation(2, 20, 2, 26, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('void', 'integer', {})
            ]);
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
                location: util.createLocation(2, 20, 2, 26, s`${rootDir}/source/main.brs`)
            }]);
        });

        it('catches function as <type> without return value', () => {
            program.setFile('source/main.brs', `
                function test() as integer
                    return
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.nonVoidFunctionMustReturnValue('function'),
                    location: util.createLocation(2, 20, 2, 26, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('void', 'integer', {})
            ]);
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
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                    location: util.createLocation(3, 24, 3, 35, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})]
            );
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
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('sub'),
                    location: util.createLocation(3, 24, 3, 35, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})
            ]);
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
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.voidFunctionMayNotReturnValue('function'),
                    location: util.createLocation(3, 24, 3, 35, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('boolean', 'void', {})
            ]);
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
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.nonVoidFunctionMustReturnValue('sub'),
                    location: util.createLocation(3, 24, 3, 30, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('void', 'integer', {})
            ]);
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
                location: util.createLocation(3, 24, 3, 30, s`${rootDir}/source/main.brs`)
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
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.nonVoidFunctionMustReturnValue('function'),
                    location: util.createLocation(3, 24, 3, 30, s`${rootDir}/source/main.brs`)
                },
                DiagnosticMessages.returnTypeMismatch('void', 'integer', {})
            ]);
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

        describe('continue', () => {
            it('allows `continue` in .brs files when minFirmwareVersion is not set', () => {
                program = new Program({});
                program.setFile('source/main.brs', `
                    sub main()
                        for i = 0 to 10
                            continue for
                        end for
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows `continue` in .brs files when minFirmwareVersion is exactly 11.5.0', () => {
                program = new Program({ minFirmwareVersion: '11.5.0' });
                program.setFile('source/main.brs', `
                    sub main()
                        for i = 0 to 10
                            continue for
                        end for
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('flags `continue` in .brs files when minFirmwareVersion is below 11.5.0', () => {
                program = new Program({ minFirmwareVersion: '11.0.0' });
                program.setFile('source/main.brs', `
                    sub main()
                        for i = 0 to 10
                            continue for
                        end for
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.featureRequiresMinFirmwareVersion('continue', '11.5.0', '11.0.0')
                }]);
            });

            it('flags `continue while` in .brs files when minFirmwareVersion is below 11.5.0', () => {
                program = new Program({ minFirmwareVersion: '11.0.0' });
                program.setFile('source/main.brs', `
                    sub main()
                        while true
                            continue while
                        end while
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.featureRequiresMinFirmwareVersion('continue', '11.5.0', '11.0.0')
                }]);
            });

            it('does not flag `continue` in .bs files below 11.5.0 because it gets transpiled', () => {
                program = new Program({ minFirmwareVersion: '11.0.0' });
                program.setFile('source/main.bs', `
                    sub main()
                        for i = 0 to 10
                            continue for
                        end for
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('does not flag `continue` in .brs files below 11.5.0 when allowBrighterScriptInBrightScript forces transpilation', () => {
                program = new Program({ minFirmwareVersion: '11.0.0', allowBrighterScriptInBrightScript: true });
                program.setFile('source/main.brs', `
                    sub main()
                        for i = 0 to 10
                            continue for
                        end for
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
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
